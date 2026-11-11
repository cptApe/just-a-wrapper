import 'server-only';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { customToolDispatch, member, pendingConfirmation, session, workspace } from '@/db/schema';
import type { ParkedToolCall } from '@/features/tool-catalog/types';
import {
  confirmationMachine,
  TOOL_DECISION_MAX_AGE_MS,
  type ToolDelivery,
  type ToolDeliveryStatus,
  toolDeliveryMachine,
} from '../lib/tool-delivery-machine';

export async function readToolDelivery(sessionId: string, toolUseId: string) {
  return (
    await db
      .select()
      .from(customToolDispatch)
      .where(
        and(
          eq(customToolDispatch.sessionId, sessionId),
          eq(customToolDispatch.toolUseId, toolUseId),
        ),
      )
  ).at(0);
}

export async function moveToolDelivery(input: {
  sessionId: string;
  toolUseId: string;
  to: Exclude<ToolDeliveryStatus, 'awaiting_decision' | 'claimed'>;
  delivery: ToolDelivery | null;
  staleBefore: Date | null;
}): Promise<boolean> {
  const rows = await db
    .update(customToolDispatch)
    .set({
      status: input.to,
      updatedAt: new Date(),
      ...(input.to === 'completed' || input.to === 'abandoned'
        ? { delivery: null }
        : input.delivery === null
          ? {}
          : { delivery: input.delivery }),
    })
    .where(
      and(
        eq(customToolDispatch.sessionId, input.sessionId),
        eq(customToolDispatch.toolUseId, input.toolUseId),
        // Only a decision moves a waiting call, so execution and recovery can never answer it.
        inArray(
          customToolDispatch.status,
          toolDeliveryMachine.sourcesOf(input.to).filter((from) => from !== 'awaiting_decision'),
        ),
        input.staleBefore === null
          ? undefined
          : lt(customToolDispatch.updatedAt, input.staleBefore),
      ),
    )
    .returning({ id: customToolDispatch.toolUseId });
  return rows.length === 1;
}

// Bumping updatedAt rotates a delivered record out of the oldest recovery batch, so a record that
// cannot accrue does not starve newer ones. The compare-and-set loses to a concurrent sweep.
export async function claimDeliveredRecovery(dispatch: { toolUseId: string; updatedAt: Date }) {
  const rows = await db
    .update(customToolDispatch)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(customToolDispatch.toolUseId, dispatch.toolUseId),
        eq(customToolDispatch.status, 'delivered'),
        sql`date_trunc('milliseconds', ${customToolDispatch.updatedAt}) = ${dispatch.updatedAt}`,
      ),
    )
    .returning({ id: customToolDispatch.toolUseId });
  return rows.length === 1;
}

export async function claimToolDecision(input: {
  anthropicSessionId: string;
  workspaceId: string;
  userId: string;
  toolUseId: string;
  decision: 'allow' | 'deny';
}) {
  const deniedDelivery: ToolDelivery = {
    isError: true,
    source: 'tool_call',
    content: { code: 'USER_DENIED', message: 'The user denied this action.' },
  };
  const status = input.decision === 'allow' ? 'approved' : 'denied';
  return db.transaction(async (tx) => {
    const claimed = (
      await tx
        .update(pendingConfirmation)
        .set({ status, decidedByUserId: input.userId, decidedAt: new Date() })
        .where(
          and(
            eq(pendingConfirmation.toolUseId, input.toolUseId),
            eq(pendingConfirmation.workspaceId, input.workspaceId),
            eq(
              pendingConfirmation.sessionId,
              tx
                .select({ id: session.id })
                .from(session)
                .where(
                  and(
                    eq(session.anthropicSessionId, input.anthropicSessionId),
                    eq(session.createdByUserId, input.userId),
                    eq(session.workspaceId, input.workspaceId),
                  ),
                ),
            ),
            inArray(pendingConfirmation.status, confirmationMachine.sourcesOf(status)),
            gte(pendingConfirmation.createdAt, new Date(Date.now() - TOOL_DECISION_MAX_AGE_MS)),
          ),
        )
        .returning()
    ).at(0);
    // A confirmation parked before its call had a delivery row still gets one here.
    if (claimed) {
      const decided =
        input.decision === 'deny'
          ? { status: 'ready' as const, delivery: deniedDelivery }
          : { status: 'claimed' as const };
      await tx
        .insert(customToolDispatch)
        .values({
          sessionId: claimed.sessionId,
          toolUseId: claimed.toolUseId,
          toolName: claimed.toolName,
          ...decided,
        })
        .onConflictDoUpdate({
          target: customToolDispatch.toolUseId,
          set: { updatedAt: new Date(), ...decided },
          // Both decisions leave awaiting_decision (toolDeliveryMachine); any other row is settled.
          setWhere: eq(customToolDispatch.status, 'awaiting_decision'),
        });
    }
    return claimed;
  });
}

export async function expireToolDecisions(sessionId: string) {
  return db.transaction(async (tx) => {
    const actor = (
      await tx
        .select({ id: member.id })
        .from(session)
        .innerJoin(workspace, eq(workspace.id, session.workspaceId))
        .innerJoin(
          member,
          and(
            eq(member.organizationId, workspace.organizationId),
            eq(member.userId, session.createdByUserId),
          ),
        )
        .where(eq(session.id, sessionId))
        .limit(1)
    ).at(0);
    const code = actor ? 'CONFIRMATION_EXPIRED' : 'FORBIDDEN';
    const message = actor
      ? 'This approval request expired without a decision.'
      : 'The task creator is no longer a workspace member.';
    const expired = await tx
      .update(pendingConfirmation)
      .set({ status: 'denied', decidedAt: new Date() })
      .where(
        and(
          eq(pendingConfirmation.sessionId, sessionId),
          inArray(pendingConfirmation.status, confirmationMachine.sourcesOf('denied')),
          actor
            ? lt(pendingConfirmation.createdAt, new Date(Date.now() - TOOL_DECISION_MAX_AGE_MS))
            : undefined,
        ),
      )
      .returning();
    for (const row of expired) {
      await tx
        .update(customToolDispatch)
        .set({
          status: 'ready',
          updatedAt: new Date(),
          delivery: {
            isError: true,
            source: 'tool_call',
            detail: code,
            content: { code, message },
          },
        })
        .where(
          and(
            eq(customToolDispatch.sessionId, sessionId),
            eq(customToolDispatch.toolUseId, row.toolUseId),
            eq(customToolDispatch.status, 'awaiting_decision'),
          ),
        );
    }
    return expired;
  });
}

// Claim the batch in one transaction before handlers run. Claims survive handler failures
// because repeating an unknown external side effect is unsafe. A parked call is born awaiting a
// decision. A call another request already claimed is an expected race, so it comes back in
// `unclaimed` for the caller to recover.
export async function claimAnthropicCustomToolCalls<
  Call extends { toolUseId: string; name: string },
>(
  sessionRowId: string,
  calls: ReadonlyArray<Call>,
  parkedCalls: ReadonlyArray<ParkedToolCall> = [],
): Promise<{ claimed: Call[]; unclaimed: Call[] }> {
  const parkedIds = new Set(parkedCalls.map((call) => call.toolUseId));
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(customToolDispatch)
      .values(
        calls.map((call) => ({
          toolUseId: call.toolUseId,
          sessionId: sessionRowId,
          toolName: call.name,
          status: parkedIds.has(call.toolUseId)
            ? ('awaiting_decision' as const)
            : ('claimed' as const),
        })),
      )
      .onConflictDoNothing()
      .returning({ toolUseId: customToolDispatch.toolUseId });
    const claimedIds = new Set(inserted.map((row) => row.toolUseId));
    const claimed = calls.filter((call) => claimedIds.has(call.toolUseId));
    const unclaimed = calls.filter((call) => !claimedIds.has(call.toolUseId));
    const parkedClaims = parkedCalls.filter((call) => claimedIds.has(call.toolUseId));
    if (parkedClaims.length > 0) {
      await tx
        .insert(pendingConfirmation)
        .values(
          parkedClaims.map((call) => ({
            sessionId: sessionRowId,
            workspaceId: call.workspaceId,
            toolUseId: call.toolUseId,
            toolName: call.name,
            input: call.input,
            requestedByUserId: call.requestedByUserId,
          })),
        )
        .onConflictDoNothing({ target: pendingConfirmation.toolUseId });
    }
    return { claimed, unclaimed };
  });
}
