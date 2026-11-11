import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session, task, workspace } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { STALE_SESSION_SECONDS } from '../constants';
import { isPauseStatus, sessionMachine } from '../lib/session-machine';

type Session = typeof session.$inferSelect;
type Executor = Pick<typeof db, 'update'>;

// A row version identifies the claim so an old request cannot roll back a newer attempt.
export async function transitionSession(input: {
  where: SQL | undefined;
  to: Session['status'];
  expected: { status: Session['status']; version: number } | null;
  pause: { reason: NonNullable<Session['pausedReason']>; at: Date } | null;
  activity: { at: Date; stopReason: Session['stopReason'] } | null;
  executor: Executor;
}) {
  const paused = isPauseStatus(input.to);
  if (paused && !input.pause)
    throw new AppError('CONFLICT', 'A paused session requires a pause reason and timestamp', {
      status: input.to,
    });
  return input.executor
    .update(session)
    .set({
      status: input.to,
      statusChangedAt: new Date(),
      stateVersion: sql`${session.stateVersion} + 1`,
      pausedAt: paused ? input.pause?.at : null,
      pausedReason: paused ? input.pause?.reason : null,
      lastEventAt: input.activity
        ? sql`greatest(${session.lastEventAt}, ${input.activity.at})`
        : undefined,
      stopReason: input.activity?.stopReason ?? null,
      endedAt:
        input.to === 'terminated'
          ? (input.activity?.at ?? new Date())
          : input.to === 'idle' && input.activity && input.activity.stopReason !== 'budget_reached'
            ? input.activity.at
            : null,
    })
    .where(
      and(
        input.where,
        input.activity
          ? sql`(${session.lastEventAt} is null or ${session.lastEventAt} < ${input.activity.at})`
          : ne(session.status, input.to),
        inArray(session.status, sessionMachine.sourcesOf(input.to)),
        input.expected
          ? and(
              eq(session.status, input.expected.status),
              eq(session.stateVersion, input.expected.version),
            )
          : undefined,
        input.to === 'terminated' ? undefined : isNull(session.hiddenAt),
      ),
    )
    .returning();
}

export async function finishSessionResume(
  claim: Session,
  to: 'running' | 'paused_no_credits',
): Promise<boolean> {
  if (!claim.pausedReason || !claim.pausedAt) return false;
  const rows = await transitionSession({
    activity: null,
    executor: db,
    where: eq(session.id, claim.id),
    to,
    expected: { status: 'resuming', version: claim.stateVersion },
    pause: { reason: claim.pausedReason, at: claim.pausedAt },
  });
  return rows.length > 0;
}

export async function releaseSessionOpening(sessionId: string, version: number): Promise<boolean> {
  const rows = await transitionSession({
    activity: null,
    executor: db,
    where: eq(session.id, sessionId),
    to: 'awaiting_opening',
    expected: { status: 'opening', version },
    pause: null,
  });
  return rows.length > 0;
}

export async function claimSessionPause(
  executor: Executor,
  sessionId: string,
  reason: NonNullable<Session['pausedReason']>,
) {
  return transitionSession({
    activity: null,
    executor,
    where: eq(session.id, sessionId),
    to: 'pausing',
    expected: null,
    pause: { reason, at: new Date() },
  });
}

export async function insertSession(
  executor: Pick<typeof db, 'insert'>,
  row: Omit<typeof session.$inferInsert, 'status'> & { status: Session['status'] },
) {
  const status = row.status;
  if (isPauseStatus(status) || status === 'opening') {
    throw new AppError('CONFLICT', 'A new session cannot start in a claimed state', { status });
  }
  return executor
    .insert(session)
    .values({ ...row, status, statusChangedAt: new Date(), pausedAt: null, pausedReason: null })
    .onConflictDoNothing()
    .returning();
}

export async function attachCreatedSession(
  sessionId: string,
  providerId: string,
  { deferred }: { deferred: boolean },
) {
  const to = deferred ? 'awaiting_opening' : 'opening';
  const rows = await db
    .update(session)
    .set({
      anthropicSessionId: providerId,
      status: to,
      statusChangedAt: new Date(),
      stateVersion: sql`${session.stateVersion} + 1`,
    })
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.status, 'creating'),
        inArray(session.status, sessionMachine.sourcesOf(to)),
      ),
    )
    .returning();
  return rows.at(0) ?? null;
}

export async function failSessionCreation(
  executor: Executor,
  sessionId: string,
  providerId: string | null,
  version: number | null,
): Promise<boolean> {
  const rows = await executor
    .update(session)
    .set({
      status: 'creation_cleanup',
      anthropicSessionId: providerId,
      statusChangedAt: new Date(),
      stateVersion: sql`${session.stateVersion} + 1`,
      hiddenAt: new Date(),
    })
    .where(
      and(
        eq(session.id, sessionId),
        inArray(session.status, sessionMachine.sourcesOf('creation_cleanup')),
        version === null ? undefined : eq(session.stateVersion, version),
      ),
    )
    .returning({ id: session.id });
  return rows.length > 0;
}

export async function recordSessionProbe(sessionId: string, version: number): Promise<boolean> {
  const rows = await db
    .update(session)
    .set({ lastStatusProbeAt: new Date() })
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.stateVersion, version),
        or(ne(session.status, 'terminated'), awaitingProviderArchive),
        sql`(${session.lastStatusProbeAt} is null or ${session.lastStatusProbeAt} < now() - make_interval(secs => ${STALE_SESSION_SECONDS}))`,
      ),
    )
    .returning({ id: session.id });
  return rows.length > 0;
}

export async function renewSessionPause(
  sessionId: string,
  reason: NonNullable<Session['pausedReason']>,
) {
  const rows = await db
    .update(session)
    .set({ stateVersion: sql`${session.stateVersion} + 1`, statusChangedAt: new Date() })
    .where(
      and(
        eq(session.id, sessionId),
        eq(session.status, 'pausing'),
        inArray(session.status, sessionMachine.sourcesOf('pausing')),
        eq(session.pausedReason, reason),
        sql`${session.statusChangedAt} < now() - interval '2 minutes'`,
      ),
    )
    .returning();
  return rows.at(0) ?? null;
}

/** Rows that are hidden but whose provider session is not archived yet. */
export const awaitingProviderArchive = and(
  eq(session.status, 'terminated'),
  isNotNull(session.hiddenAt),
  isNull(session.providerArchivedAt),
);

// Hiding ends a live session, or marks a visible ended one hidden and keeps its end time.
export async function hideSessionTransition(
  executor: Pick<typeof db, 'update'>,
  where: SQL | undefined,
) {
  return executor
    .update(session)
    .set({
      status: 'terminated',
      hiddenAt: sql`coalesce(${session.hiddenAt}, now())`,
      endedAt: sql`case when ${session.status} = 'terminated' then coalesce(${session.endedAt}, now()) else now() end`,
      statusChangedAt: sql`case when ${session.status} = 'terminated' then ${session.statusChangedAt} else now() end`,
      stateVersion: sql`${session.stateVersion}+1`,
      pausedAt: null,
      pausedReason: null,
    })
    .where(
      and(
        where,
        or(
          inArray(session.status, sessionMachine.sourcesOf('terminated')),
          and(eq(session.status, 'terminated'), isNull(session.hiddenAt)),
        ),
      ),
    )
    .returning({
      id: session.id,
      visibility: session.visibility,
      createdByUserId: session.createdByUserId,
    });
}

export async function markSessionArchived(id: string, version: number): Promise<boolean> {
  const rows = await db
    .update(session)
    .set({ providerArchivedAt: new Date() })
    .where(and(eq(session.id, id), awaitingProviderArchive, eq(session.stateVersion, version)))
    .returning({ id: session.id });
  return rows.length > 0;
}

// Expired task pauses finish scheduling bookkeeping without preventing an explicit credit resume.
export async function finishExpiredTaskPause(
  executor: Executor,
  input: {
    sessionId: string;
    version: number;
    cutoff: Date;
  },
): Promise<boolean> {
  const rows = await executor
    .update(session)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(session.id, input.sessionId),
        eq(session.kind, 'task_run'),
        eq(session.status, 'paused_no_credits'),
        eq(session.stateVersion, input.version),
        lt(session.pausedAt, input.cutoff),
        isNull(session.endedAt),
      ),
    )
    .returning({ id: session.id });
  return rows.length > 0;
}

export async function recordReviewedSession(
  connection: Pick<typeof db, 'select' | 'insert'>,
  upstream: Pick<
    Anthropic.Beta.BetaManagedAgentsSession,
    'id' | 'metadata' | 'deployment_id' | 'status' | 'created_at' | 'resources'
  >,
): Promise<string | null> {
  const existing = (
    await connection
      .select({ id: session.id, kind: session.kind })
      .from(session)
      .where(eq(session.anthropicSessionId, upstream.id))
      .limit(1)
  ).at(0);
  if (existing) return existing.kind === 'task_run' ? existing.id : null;
  const taskId = upstream.metadata.task_id;
  if (!taskId) return null;
  const owner = (await connection.select().from(task).where(eq(task.id, taskId)).limit(1)).at(0);
  if (
    !owner ||
    owner.anthropicDeploymentId === null ||
    owner.anthropicDeploymentId !== upstream.deployment_id
  )
    return null;
  const workspaceRow = (
    await connection.select().from(workspace).where(eq(workspace.id, owner.workspaceId)).limit(1)
  ).at(0);
  if (!workspaceRow)
    throw new AppError('WORKSPACE_NOT_FOUND', 'Task workspace not found', {
      workspaceId: owner.workspaceId,
    });
  const memoryMount = upstream.resources
    .filter((resource) => resource.type === 'memory_store')
    .find((resource) => resource.memory_store_id === workspaceRow.workspaceMemoryStoreId);
  await insertSession(connection, {
    taskId: owner.id,
    workspaceMemoryAccess: memoryMount ? (memoryMount.access ?? 'read_write') : 'none',
    workspaceId: owner.workspaceId,
    createdByUserId: owner.createdByUserId,
    kind: 'task_run',
    tier: owner.tier,
    permissionMode: owner.autoApprove ? 'auto' : 'ask',
    visibility: owner.visibility,
    title: owner.title,
    anthropicSessionId: upstream.id,
    status: upstream.status,
    startedAt: new Date(upstream.created_at),
    lastEventAt: new Date(upstream.created_at),
  });
  const inserted = (
    await connection
      .select({ id: session.id })
      .from(session)
      .where(eq(session.anthropicSessionId, upstream.id))
      .limit(1)
  ).at(0);
  return inserted?.id ?? null;
}
