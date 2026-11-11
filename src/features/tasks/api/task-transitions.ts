import 'server-only';
import { and, eq, inArray, isNull, lt, ne, or, type SQL, sql } from 'drizzle-orm';
import { db } from '@/db';
import { task } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { taskMachine, taskProviderSyncMachine } from '../lib/task-machine';
import type { CreateScheduleTaskInput } from '../types';

// The one writer of task status, version, provider sync and the two leases (decision 0035).
// Every change to what a task is bumps `version`; caches and leases leave it alone.

export type TaskRow = typeof task.$inferSelect;
type Status = TaskRow['status'];
type Connection = Pick<typeof db, 'update'>;
export type SyncMark = 'status' | 'definition' | null;

/** A crashed pusher's lease ends after this; a live one finishes well inside it. */
export const PROVIDER_SYNC_LEASE_MS = 5 * 60_000;

// A lease read back into JavaScript has millisecond precision; Postgres may hold microseconds.
const sameInstant = (column: typeof task.syncClaimedAt | typeof task.runNowClaimedAt, at: Date) =>
  sql`date_trunc('milliseconds', ${column}) = ${at}`;

const bumped = () => ({ version: sql`${task.version} + 1`, updatedAt: new Date() });

// A definition push carries the status too, so a status mark never downgrades a pending definition.
function syncAfter(mark: SyncMark): { providerSync?: SQL } {
  if (mark === null) return {};
  if (mark === 'definition') return { providerSync: sql`'definition'` };
  return {
    providerSync: sql`case when ${task.providerSync} = 'definition' then 'definition' else 'status' end`,
  };
}

/** Moves the lifecycle and records what the provider must hear. Returns the new version. */
export async function moveTask(
  connection: Connection,
  input: {
    taskId: string;
    to: Status;
    sync: SyncMark;
    expectedVersion?: number;
    nextRunAt?: Date | null;
    lastRunAt?: Date;
  },
): Promise<number | null> {
  const moved = await connection
    .update(task)
    .set({
      status: input.to,
      ...bumped(),
      ...syncAfter(input.sync),
      ...(input.nextRunAt === undefined ? {} : { nextRunAt: input.nextRunAt }),
      ...(input.lastRunAt === undefined
        ? {}
        : { lastRunAt: sql`greatest(${task.lastRunAt}, ${input.lastRunAt})` }),
    })
    .where(
      and(
        eq(task.id, input.taskId),
        inArray(task.status, taskMachine.sourcesOf(input.to)),
        input.expectedVersion === undefined ? undefined : eq(task.version, input.expectedVersion),
      ),
    )
    .returning({ version: task.version });
  return moved.at(0)?.version ?? null;
}

type Definition = Partial<
  Pick<
    TaskRow,
    | 'title'
    | 'icon'
    | 'description'
    | 'successCriteria'
    | 'tier'
    | 'autoApprove'
    | 'notification'
    | 'attachments'
    | 'cronSchedule'
    | 'runAt'
    | 'timezone'
    | 'nextRunAt'
  >
>;

/** An edit wins only against the version it read. Null means another write came first. */
export async function writeTaskDefinition(
  connection: Connection,
  input: {
    taskId: string;
    expectedVersion: number;
    definition: Definition;
    status: 'upcoming' | 'paused';
    sync: SyncMark;
  },
): Promise<number | null> {
  const written = await connection
    .update(task)
    .set({ ...input.definition, status: input.status, ...bumped(), ...syncAfter(input.sync) })
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.version, input.expectedVersion),
        inArray(task.status, ['upcoming', 'paused']),
      ),
    )
    .returning({ version: task.version });
  return written.at(0)?.version ?? null;
}

/** Run times are a cache of the provider schedule, not part of the definition. */
export async function refreshRecurringTaskTimes(input: {
  taskId: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
}): Promise<void> {
  await db
    .update(task)
    .set({
      nextRunAt: input.nextRunAt,
      ...(input.lastRunAt === null
        ? {}
        : { lastRunAt: sql`greatest(${task.lastRunAt}, ${input.lastRunAt})` }),
    })
    .where(and(eq(task.id, input.taskId), eq(task.status, 'upcoming'), isNull(task.runAt)));
}

export async function recordEventRunStart(
  connection: Connection,
  taskId: string,
  startedAt: Date,
): Promise<void> {
  await connection
    .update(task)
    .set({ lastRunAt: sql`greatest(${task.lastRunAt}, ${startedAt})` })
    .where(and(eq(task.id, taskId), eq(task.triggerType, 'event')));
}

export async function insertScheduledTask(
  connection: Pick<typeof db, 'insert'>,
  input: CreateScheduleTaskInput,
  runAt: Date | null,
) {
  const inserted = (
    await connection
      .insert(task)
      .values({
        workspaceId: input.workspaceId,
        createdByUserId: input.createdByUserId,
        tier: input.tier,
        autoApprove: input.autoApprove,
        notification: input.notification,
        attachments: input.attachments ?? null,
        title: input.title.trim(),
        icon: input.icon,
        description: input.description.trim(),
        successCriteria: input.successCriteria?.trim() || null,
        triggerType: 'schedule',
        status: 'creating',
        cronSchedule: input.cron?.trim() ?? null,
        runAt,
        nextRunAt: runAt,
        timezone: input.timezone,
      })
      .returning({ id: task.id, version: task.version })
  ).at(0);
  if (!inserted)
    throw new AppError('UNEXPECTED', 'Task insert returned no row', {
      workspaceId: input.workspaceId,
    });
  return inserted;
}

export async function activateCreatedTask(input: {
  taskId: string;
  deploymentId: string;
  nextRunAt: Date | null;
}): Promise<boolean> {
  const moved = await db
    .update(task)
    .set({
      status: 'upcoming',
      ...bumped(),
      anthropicDeploymentId: input.deploymentId,
      nextRunAt: input.nextRunAt,
    })
    .where(and(eq(task.id, input.taskId), eq(task.status, 'creating')))
    .returning({ id: task.id });
  return moved.length > 0;
}

/** A created deployment the row cannot use is attached so the sync archives it. */
export async function rejectCreatedTaskSchedule(
  taskId: string,
  deploymentId: string,
): Promise<boolean> {
  const moved = await db
    .update(task)
    .set({
      status: 'removed',
      ...bumped(),
      ...syncAfter('status'),
      anthropicDeploymentId: deploymentId,
      nextRunAt: null,
    })
    .where(and(eq(task.id, taskId), eq(task.status, 'creating')))
    .returning({ id: task.id });
  return moved.length > 0;
}

/** The provider no longer has the resource, so there is nothing left to push. */
export async function removeUnavailableTask(taskId: string): Promise<boolean> {
  const moved = await db
    .update(task)
    .set({
      status: 'removed',
      ...bumped(),
      providerSync: 'synced',
      syncClaimedAt: null,
      nextRunAt: null,
    })
    .where(and(eq(task.id, taskId), inArray(task.status, taskMachine.sourcesOf('removed'))))
    .returning({ id: task.id });
  return moved.length > 0;
}

// Revocation removes in the membership transaction; the sync sweep owns provider cleanup.
export async function cancelMemberTasks(
  connection: Connection,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await connection
    .update(task)
    .set({ status: 'removed', ...bumped(), ...syncAfter('status'), nextRunAt: null })
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        eq(task.createdByUserId, userId),
        // A finished one-off stays in the creator's history.
        inArray(
          task.status,
          taskMachine.sourcesOf('removed').filter((status) => status !== 'done'),
        ),
      ),
    );
}

/** Marks drift found outside an edit, such as a changed agent or creator grounding. */
export async function markDefinitionDrift(taskId: string): Promise<void> {
  await db
    .update(task)
    .set({ providerSync: 'definition' })
    .where(
      and(
        eq(task.id, taskId),
        inArray(task.providerSync, taskProviderSyncMachine.sourcesOf('definition')),
      ),
    );
}

/** Takes the row's sync lease; a held or expired-free lease means another worker owns it. */
export async function claimProviderSync(taskId: string): Promise<TaskRow | null> {
  const now = new Date();
  const rows = await db
    .update(task)
    .set({ syncClaimedAt: now })
    .where(
      and(
        eq(task.id, taskId),
        ne(task.providerSync, 'synced'),
        or(
          isNull(task.syncClaimedAt),
          lt(task.syncClaimedAt, new Date(now.getTime() - PROVIDER_SYNC_LEASE_MS)),
        ),
      ),
    )
    .returning();
  return rows.at(0) ?? null;
}

/**
 * Settles a push of `version`. A newer write in between keeps the mark, and the pusher goes again.
 * `move` applies a status the provider forced (a one-off it could not schedule).
 */
export async function finishProviderSync(input: {
  claim: Pick<TaskRow, 'id' | 'version' | 'syncClaimedAt'>;
  nextRunAt?: Date | null;
  snapshotHash?: string;
  move?: 'paused';
}): Promise<boolean> {
  const { claim } = input;
  const settled = await db
    .update(task)
    .set({
      providerSync: 'synced',
      syncClaimedAt: null,
      ...(input.nextRunAt === undefined ? {} : { nextRunAt: input.nextRunAt }),
      ...(input.snapshotHash === undefined ? {} : { deploymentSnapshotHash: input.snapshotHash }),
      ...(input.move ? { status: input.move, ...bumped(), nextRunAt: null } : {}),
    })
    .where(
      and(
        eq(task.id, claim.id),
        eq(task.version, claim.version),
        claim.syncClaimedAt ? sameInstant(task.syncClaimedAt, claim.syncClaimedAt) : undefined,
        inArray(task.providerSync, taskProviderSyncMachine.sourcesOf('synced')),
        input.move ? inArray(task.status, taskMachine.sourcesOf(input.move)) : undefined,
      ),
    )
    .returning({ id: task.id });
  if (settled.length > 0) return true;
  await releaseProviderSync(claim);
  return false;
}

export async function releaseProviderSync(
  claim: Pick<TaskRow, 'id' | 'syncClaimedAt'>,
): Promise<void> {
  if (!claim.syncClaimedAt) return;
  await db
    .update(task)
    .set({ syncClaimedAt: null })
    .where(and(eq(task.id, claim.id), sameInstant(task.syncClaimedAt, claim.syncClaimedAt)));
}

/** One run-now at a time. The lease ends when its run is known to exist or known to have failed. */
export async function claimRunNow(taskId: string): Promise<Date | null> {
  const claimedAt = new Date();
  const rows = await db
    .update(task)
    .set({ runNowClaimedAt: claimedAt })
    .where(
      and(
        eq(task.id, taskId),
        inArray(task.status, ['upcoming', 'paused']),
        isNull(task.runNowClaimedAt),
      ),
    )
    .returning({ id: task.id });
  return rows.length > 0 ? claimedAt : null;
}

export async function releaseRunNow(taskId: string, claimedAt: Date | null): Promise<void> {
  await db
    .update(task)
    .set({ runNowClaimedAt: null })
    .where(
      and(
        eq(task.id, taskId),
        claimedAt === null ? undefined : sameInstant(task.runNowClaimedAt, claimedAt),
      ),
    );
}
