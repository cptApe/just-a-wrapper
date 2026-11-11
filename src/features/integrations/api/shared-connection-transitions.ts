import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { sharedIntegration, user, workspace, workspaceMember } from '@/db/schema';
import { sharedConnectionMachine } from '../lib/shared-connection-machine';

type ShareKey = { workspaceId: string; toolkit: string };

function shareKey(input: ShareKey) {
  return and(
    eq(sharedIntegration.workspaceId, input.workspaceId),
    eq(sharedIntegration.toolkit, input.toolkit),
  );
}

/** Live shares for a workspace, by organization. Rows being removed are already invisible. */
export async function readWorkspaceShares(organizationId: string) {
  return db
    .select({
      workspaceId: sharedIntegration.workspaceId,
      toolkit: sharedIntegration.toolkit,
      status: sharedIntegration.status,
      connectedAccountId: sharedIntegration.connectedAccountId,
      createdAt: sharedIntegration.createdAt,
      sharedByName: user.name,
    })
    .from(sharedIntegration)
    .innerJoin(workspace, eq(workspace.id, sharedIntegration.workspaceId))
    .leftJoin(user, eq(user.id, sharedIntegration.sharedByUserId))
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        inArray(sharedIntegration.status, ['pending', 'active']),
      ),
    );
}

export type WorkspaceShare = Awaited<ReturnType<typeof readWorkspaceShares>>[number];

/**
 * Claim the toolkit for a new share; the returned attempt id guards every later step.
 * Each claim mints a fresh row id. A pending row that holds an account must be retired first.
 */
export async function claimPendingShare(
  input: ShareKey & { sharedByUserId: string },
): Promise<string | null> {
  const rows = await db
    .insert(sharedIntegration)
    .values({ ...input, status: 'pending' })
    .onConflictDoUpdate({
      target: [sharedIntegration.workspaceId, sharedIntegration.toolkit],
      set: {
        id: sql`gen_random_uuid()`,
        status: 'pending',
        sharedByUserId: input.sharedByUserId,
        createdAt: sql`now()`,
      },
      setWhere: and(
        inArray(sharedIntegration.status, sharedConnectionMachine.sourcesOf('pending')),
        isNull(sharedIntegration.connectedAccountId),
      ),
    })
    .returning({ id: sharedIntegration.id });
  return rows.at(0)?.id ?? null;
}

type ShareAttempt = ShareKey & { attempt: string };

function attemptKey(input: ShareAttempt) {
  return and(
    shareKey(input),
    eq(sharedIntegration.id, input.attempt),
    eq(sharedIntegration.status, 'pending'),
  );
}

/** False means a newer claim replaced this attempt, so no row owns its account. */
export async function attachPendingAccount(
  input: ShareAttempt & { connectedAccountId: string },
): Promise<boolean> {
  const rows = await db
    .update(sharedIntegration)
    .set({ connectedAccountId: input.connectedAccountId })
    .where(and(attemptKey(input), isNull(sharedIntegration.connectedAccountId)))
    .returning({ id: sharedIntegration.id });
  return rows.length > 0;
}

export async function abandonPendingShare(input: ShareAttempt): Promise<void> {
  await db.delete(sharedIntegration).where(attemptKey(input));
}

export async function activateShare(
  input: ShareKey & { connectedAccountId: string },
): Promise<boolean> {
  const rows = await db
    .update(sharedIntegration)
    .set({ status: 'active' })
    .where(
      and(
        shareKey(input),
        eq(sharedIntegration.connectedAccountId, input.connectedAccountId),
        inArray(sharedIntegration.status, sharedConnectionMachine.sourcesOf('active')),
      ),
    )
    .returning({ id: sharedIntegration.id });
  return rows.length > 0;
}

export type ShareRemoval = {
  workspaceId: string;
  toolkit: string;
  connectedAccountId: string | null;
  organizationId: string;
};

const removalColumns = {
  workspaceId: sharedIntegration.workspaceId,
  toolkit: sharedIntegration.toolkit,
  connectedAccountId: sharedIntegration.connectedAccountId,
  organizationId: workspace.organizationId,
};

/** Claim one share for removal. Null means nothing live remains to remove. */
export async function beginShareRemoval(input: ShareKey): Promise<ShareRemoval | null> {
  const moved = await db
    .update(sharedIntegration)
    .set({ status: 'removing' })
    .where(
      and(
        shareKey(input),
        inArray(sharedIntegration.status, sharedConnectionMachine.sourcesOf('removing')),
      ),
    )
    .returning({ id: sharedIntegration.id });
  return moved.length === 0 ? null : readRemoval(input);
}

/** A restart queues the earlier attempt's account for deletion, so the sweep retries a failure. */
export async function beginPendingRestart(input: ShareKey): Promise<ShareRemoval | null> {
  const moved = await db
    .update(sharedIntegration)
    .set({ status: 'removing' })
    .where(
      and(
        shareKey(input),
        inArray(sharedIntegration.status, sharedConnectionMachine.sourcesOf('removing')),
        eq(sharedIntegration.status, 'pending'),
        isNotNull(sharedIntegration.connectedAccountId),
      ),
    )
    .returning({ id: sharedIntegration.id });
  return moved.length === 0 ? null : readRemoval(input);
}

async function readRemoval(input: ShareKey): Promise<ShareRemoval | null> {
  return (
    (
      await db
        .select(removalColumns)
        .from(sharedIntegration)
        .innerJoin(workspace, eq(workspace.id, sharedIntegration.workspaceId))
        .where(shareKey(input))
        .limit(1)
    ).at(0) ?? null
  );
}

export async function listShareRemovals(limit: number): Promise<ShareRemoval[]> {
  return db
    .select(removalColumns)
    .from(sharedIntegration)
    .innerJoin(workspace, eq(workspace.id, sharedIntegration.workspaceId))
    .where(eq(sharedIntegration.status, 'removing'))
    .limit(limit);
}

export async function finishShareRemoval(input: ShareKey): Promise<void> {
  await db
    .delete(sharedIntegration)
    .where(and(shareKey(input), eq(sharedIntegration.status, 'removing')));
}

/** A departing member's accounts are theirs, so everything they shared stops with them. */
export async function revokeSharesByMember(
  tx: DbTransaction,
  composioUserId: string,
): Promise<void> {
  const departing = (
    await tx
      .select({ userId: workspaceMember.userId, organizationId: workspaceMember.organizationId })
      .from(workspaceMember)
      .where(eq(workspaceMember.composioUserId, composioUserId))
      .limit(1)
  ).at(0);
  if (departing === undefined) return;
  await tx
    .update(sharedIntegration)
    .set({ status: 'removing' })
    .where(
      and(
        eq(sharedIntegration.sharedByUserId, departing.userId),
        inArray(sharedIntegration.status, sharedConnectionMachine.sourcesOf('removing')),
        inArray(
          sharedIntegration.workspaceId,
          tx
            .select({ id: workspace.id })
            .from(workspace)
            .where(eq(workspace.organizationId, departing.organizationId)),
        ),
      ),
    );
}
