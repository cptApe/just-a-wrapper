import 'server-only';
import { and, asc, eq, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { customToolDispatch, pendingConfirmation, session } from '@/db/schema';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import { TOOL_DECLARATIONS } from '@/features/tool-catalog/declarations';
import type { CustomToolDeclaration, DispatchOutcome } from '@/features/tool-catalog/types';
import { captureException } from '@/lib/observability';
import { runAndPost } from './dispatch-execution';
import { getCustomTool } from './registry';
import {
  deliverStoredTool,
  recoverStoredToolDelivery,
  recoverToolDelivery,
  storeAndDeliver,
} from './tool-delivery';
import { claimToolDecision, expireToolDecisions } from './tool-delivery-transitions';

type ConfirmDecision = { toolUseId: string; decision: 'allow' | 'deny' };
export type ConfirmOutcome =
  | { toolUseId: string; status: 'resolved'; isError: boolean }
  | { toolUseId: string; status: 'skipped'; detail: string };

type ConfirmScope = { anthropicSessionId: string; workspaceId: string; userId: string };

// Only the creator decides: the grant proves the caller created this session.
export async function confirmPendingTools(input: {
  grant: SessionWriteGrant;
  decisions: ConfirmDecision[];
}): Promise<ConfirmOutcome[]> {
  const args: ConfirmScope = {
    anthropicSessionId: input.grant.anthropicSessionId,
    workspaceId: input.grant.workspaceId,
    userId: input.grant.userId,
  };
  const outcomes: ConfirmOutcome[] = [];
  for (const decision of input.decisions) {
    outcomes.push(
      await (async (): Promise<ConfirmOutcome> => {
        try {
          const claimed = await claimToolDecision({ ...args, ...decision });
          const row =
            claimed ??
            (
              await db
                .select()
                .from(pendingConfirmation)
                .where(
                  and(
                    eq(pendingConfirmation.toolUseId, decision.toolUseId),
                    eq(pendingConfirmation.workspaceId, args.workspaceId),
                    eq(
                      pendingConfirmation.sessionId,
                      db
                        .select({ id: session.id })
                        .from(session)
                        .where(
                          and(
                            eq(session.anthropicSessionId, args.anthropicSessionId),
                            eq(session.workspaceId, args.workspaceId),
                          ),
                        ),
                    ),
                  ),
                )
            ).at(0);
          if (!row)
            return { toolUseId: decision.toolUseId, status: 'skipped', detail: 'NOT_PENDING' };
          if (!claimed && row.status === 'pending') await expireToolDecisions(row.sessionId);
          const ctx = {
            ...args,
            sessionRowId: row.sessionId,
          };
          let outcome: DispatchOutcome;
          if (!claimed) outcome = await recoverToolDelivery(ctx, row.toolUseId);
          else if (decision.decision === 'deny') {
            outcome = await deliverStoredTool(ctx, row.toolUseId);
          } else {
            outcome = await executeApprovedTool(row, args);
          }

          return outcome.status === 'posted'
            ? {
                toolUseId: row.toolUseId,
                status: 'resolved',
                isError: outcome.isError === true,
              }
            : { toolUseId: row.toolUseId, status: 'skipped', detail: 'EXECUTING' };
        } catch (error) {
          captureException(error, {
            feature: 'tooling',
            op: 'confirm-delivery',
            toolUseId: decision.toolUseId,
          });
          return { toolUseId: decision.toolUseId, status: 'skipped', detail: 'DELIVERY_PENDING' };
        }
      })(),
    );
  }
  return outcomes;
}

async function executeApprovedTool(
  row: typeof pendingConfirmation.$inferSelect,
  args: ConfirmScope,
): Promise<DispatchOutcome> {
  const context = { ...args, sessionRowId: row.sessionId };
  const tool = await getCustomTool(row.toolName);
  const prepared = tool?.prepare(row.input);
  if (!tool || !prepared?.success) {
    return storeAndDeliver(context, row.toolUseId, {
      isError: true,
      source: 'tool_call',
      detail: 'TOOL_INPUT_INVALID',
      content: {
        code: 'TOOL_INPUT_INVALID',
        message: 'Confirmed tool is unavailable or input is invalid.',
      },
    });
  }
  return runAndPost(tool, prepared.data, row.toolUseId, { ...context, actorUserId: args.userId });
}

/** List a session's still-pending confirmations (the stepper's data source). */
export async function listPendingConfirmations(sessionRowId: string): Promise<
  Array<{
    toolUseId: string;
    toolName: string;
    description: string;
    riskLevel: CustomToolDeclaration['riskLevel'];
    input: unknown;
    createdAt: Date;
  }>
> {
  await expireToolDecisions(sessionRowId);
  const owner = (
    await db
      .select({ anthropicSessionId: session.anthropicSessionId })
      .from(session)
      .where(eq(session.id, sessionRowId))
  ).at(0);
  if (owner?.anthropicSessionId) {
    const deliveries = await db
      .select()
      .from(customToolDispatch)
      .where(
        and(
          eq(customToolDispatch.sessionId, sessionRowId),
          notInArray(customToolDispatch.status, ['awaiting_decision', 'completed', 'abandoned']),
        ),
      );
    for (const delivery of deliveries) {
      try {
        await recoverStoredToolDelivery(
          { sessionRowId, anthropicSessionId: owner.anthropicSessionId },
          delivery,
        );
      } catch (cause) {
        captureException(cause, {
          feature: 'tooling',
          op: 'list-recover-delivery',
          toolUseId: delivery.toolUseId,
        });
      }
    }
  }
  const rows = await db
    .select({
      toolUseId: pendingConfirmation.toolUseId,
      toolName: pendingConfirmation.toolName,
      input: pendingConfirmation.input,
      createdAt: pendingConfirmation.createdAt,
    })
    .from(pendingConfirmation)
    .where(
      and(
        eq(pendingConfirmation.sessionId, sessionRowId),
        eq(pendingConfirmation.status, 'pending'),
      ),
    )
    // Keep pending confirmations in arrival order.
    .orderBy(asc(pendingConfirmation.createdAt));
  return rows.map((row) => {
    const declaration = TOOL_DECLARATIONS.find((tool) => tool.name === row.toolName);
    return {
      ...row,
      description: declaration?.description ?? row.toolName,
      // A tool missing from the catalog still reached a confirmation, so assume the worst.
      riskLevel: declaration?.riskLevel ?? 'destructive',
    };
  });
}
