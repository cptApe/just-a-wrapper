import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, count, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  file,
  folder,
  folderShare,
  member,
  organization,
  session,
  sessionFileMount,
  sessionShare,
  skill,
  task,
  user,
  workspace,
  workspaceMember,
} from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { anonymizeAccount, purgeAccount } from '@/features/auth/api/account-lifecycle-transitions';
import { deleteBlob } from '@/features/files/api/blob-storage';
import { reconcileAnthropicUploads } from '@/features/files/api/reconcile-anthropic-uploads';
import { deleteSessionFileMounts } from '@/features/files/api/session-file-mounts';
import { sweepStoredFiles } from '@/features/files/server';
import { enqueueMemberCleanup } from '@/features/integrations/api/member-cleanup-transitions';
import { workspaceConnectionOwnerId } from '@/features/integrations/lib/shared-connection-machine';
import { removeSkill } from '@/features/skills/api/skill-transitions';
import { deleteWorkspaceBrowserContexts } from '@/features/tools/api/browser-contexts';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { assertBeforeDeadline, DeadlineReached, sweepDeadline } from '@/lib/sweep-deadline';
import { purgeCutoff } from '../lib/purge-policy';
import { cancelWorkspaceSubscription } from './cancel-workspace-subscription';
import { cleanupDeletedWorkspaceBrowsers } from './cleanup-deleted-workspace-browsers';
import { deleteSessionsUpstream } from './delete-sessions-upstream';
import { purgeWorkspaceRows } from './purge-workspace-rows';
import { stopWorkspaceTasks } from './stop-workspace-tasks';
import {
  claimWorkspacePurge,
  finishWorkspaceDeletion,
  finishWorkspacePurge,
  recordWorkspacePurgeAttempt,
} from './workspace-lifecycle-transitions';

type SweepResult = {
  candidates: number;
  deleted: number;
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
};
type SweepRun = { cutoff: Date; dryRun: boolean; deadline: number };
const emptyResult = (): SweepResult => ({ candidates: 0, deleted: 0, skipped: [], failed: [] });
function recordFailure(report: SweepResult, id: string, error: unknown) {
  if (error instanceof DeadlineReached) {
    report.skipped.push({ id, reason: error.message });
    return;
  }
  report.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
}

async function purgeCandidate(report: SweepResult, id: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    if (!(error instanceof DeadlineReached))
      captureException(error, { feature: 'workspaces', op: 'purge', entityId: id });
    recordFailure(report, id, error);
  }
}

/** Deleting is a durable retry state for immediate subscription cancellation. */
export async function finishDeletingWorkspaces(
  deadline: number,
  scope: { kind: 'backlog' } | { kind: 'workspaces'; ids: string[] },
) {
  const candidates = await db
    .select()
    .from(workspace)
    .where(
      and(
        eq(workspace.lifecycleStatus, 'deleting'),
        scope.kind === 'workspaces' ? inArray(workspace.id, scope.ids) : undefined,
      ),
    )
    .orderBy(sql`${workspace.purgeAttemptedAt} asc nulls first`, workspace.id)
    .limit(50);
  const report = emptyResult();
  report.candidates = candidates.length;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    await purgeCandidate(report, candidate.id, async () => {
      await recordWorkspacePurgeAttempt(candidate.id);
      await cleanupDeletedWorkspaceBrowsers(candidate.id);
      await cancelWorkspaceSubscription(candidate);
      await stopWorkspaceTasks(candidate.id, deadline);
      if (await finishWorkspaceDeletion(candidate.id)) report.deleted += 1;
    });
  }
  return report;
}

export async function purgeExpired({ dryRun }: { dryRun: boolean }) {
  const cutoff = purgeCutoff(new Date());
  const deadline = sweepDeadline();
  const run: SweepRun = { cutoff, dryRun, deadline };
  const settle = async <T>(name: string, sweep: () => Promise<T>) => {
    try {
      return await sweep();
    } catch (error) {
      captureException(error, { op: 'purge-sweep', sweep: name });
      const report = emptyResult();
      recordFailure(report, name, error);
      return report;
    }
  };
  const deleting = await settle('deleting', () =>
    dryRun
      ? Promise.resolve(emptyResult())
      : finishDeletingWorkspaces(deadline, { kind: 'backlog' }),
  );
  const workspaces = await settle('workspaces', () => sweepWorkspaces(run));
  const memberlessOrgs = await settle('memberlessOrgs', () => sweepMemberlessOrgs(run));
  const users = await settle('users', () => sweepUsers(run));
  const uploads = await settle('uploads', () =>
    reconcileAnthropicUploads({ dryRun, deadline, scope: 'orphans' }),
  );
  const storedFiles = await sweepStoredFiles({ dryRun });
  return { dryRun, deleting, workspaces, memberlessOrgs, users, storedFiles, uploads };
}

async function removeWorkspaceResources(
  candidate: typeof workspace.$inferSelect,
  deadline: number,
) {
  assertBeforeDeadline(deadline);
  await cancelWorkspaceSubscription(candidate);
  await deleteSessionFileMounts(eq(sessionFileMount.workspaceId, candidate.id), deadline);
  const skills = await db.select().from(skill).where(eq(skill.ownerWorkspaceId, candidate.id));
  for (const row of skills) {
    assertBeforeDeadline(deadline);
    await removeSkill(row);
  }
  const sessions = await db
    .select({ id: session.anthropicSessionId })
    .from(session)
    .where(eq(session.workspaceId, candidate.id));
  const sessionIds = sessions.flatMap(({ id }) => (id === null ? [] : [id]));
  const client = getAnthropicClient();
  if (client === null && (sessionIds.length > 0 || candidate.workspaceMemoryStoreId !== null)) {
    throw new AppError(
      'INTEGRATION_NOT_CONNECTED',
      'Workspace purge requires Anthropic for retained resources',
      { workspaceId: candidate.id },
    );
  }
  if (client !== null) {
    const report = await deleteSessionsUpstream(client, sessionIds, deadline);
    if (report.completedIds.length > 0) {
      await db
        .update(session)
        .set({ anthropicSessionId: null })
        .where(
          and(
            eq(session.workspaceId, candidate.id),
            inArray(session.anthropicSessionId, report.completedIds),
          ),
        );
    }
    if (report.failed > 0)
      throw new AppError(
        'EXTERNAL_API_FAILED',
        'Workspace upstream sessions remain; purge retries from retained rows',
        { workspaceId: candidate.id, failed: report.failed },
      );
    if (report.deferred > 0) throw new DeadlineReached(deadline);
    assertBeforeDeadline(deadline);
    if (candidate.workspaceMemoryStoreId !== null) {
      try {
        await client.beta.memoryStores.delete(candidate.workspaceMemoryStoreId, undefined, {
          timeout: 10_000,
          maxRetries: 0,
        });
      } catch (cause) {
        if (!(cause instanceof APIError && cause.status === 404))
          throw new AppError(
            'EXTERNAL_API_FAILED',
            'Workspace memory deletion failed',
            { workspaceId: candidate.id },
            { cause },
          );
      }
    }
  }
  assertBeforeDeadline(deadline);
  await deleteWorkspaceBrowserContexts(candidate.id);
}

async function sweepWorkspaces({ cutoff, dryRun, deadline }: SweepRun) {
  const report = emptyResult();
  const candidates = await db
    .select()
    .from(workspace)
    .where(
      and(
        inArray(workspace.lifecycleStatus, ['deleted', 'purging']),
        lt(workspace.deletedAt, cutoff),
      ),
    )
    .orderBy(sql`${workspace.purgeAttemptedAt} asc nulls first`, workspace.id)
    .limit(25);
  report.candidates = candidates.length;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (dryRun) continue;
    await purgeCandidate(report, candidate.id, async () => {
      await recordWorkspacePurgeAttempt(candidate.id);
      const claimedAt = await claimWorkspacePurge(candidate.id, cutoff);
      if (claimedAt === null) {
        report.skipped.push({
          id: candidate.id,
          reason: 'Purge already claimed or no longer eligible',
        });
        return;
      }
      await removeWorkspaceResources(candidate, deadline);
      const blobs = await db
        .select({ storagePath: file.storagePath, thumbnailPath: file.thumbnailPath })
        .from(file)
        .where(eq(file.workspaceId, candidate.id));
      await commitWorkspacePurge(candidate, claimedAt);
      await removeCommittedWorkspaceBlobs(candidate.id, blobs, deadline);
      report.deleted += 1;
    });
  }
  return report;
}

async function commitWorkspacePurge(
  candidate: typeof workspace.$inferSelect,
  claimedAt: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const provisioned = await tx
      .select()
      .from(workspaceMember)
      .where(eq(workspaceMember.organizationId, candidate.organizationId));
    for (const membership of provisioned)
      await enqueueMemberCleanup(tx, {
        composioUserId: membership.composioUserId,
        vaultId: membership.mcpProxyVaultId,
        memoryStoreId: membership.userMemoryStoreId,
      });
    // The purge cascades the share rows; this durable row deletes their Composio accounts.
    await enqueueMemberCleanup(tx, {
      composioUserId: workspaceConnectionOwnerId(candidate.id),
      vaultId: null,
      memoryStoreId: null,
    });
    await purgeWorkspaceRows(tx, candidate.id);
    if (!(await finishWorkspacePurge(tx, candidate.id, claimedAt)))
      throw new AppError('CONFLICT', 'Workspace purge lost claim', {
        workspaceId: candidate.id,
      });
    await tx.delete(organization).where(eq(organization.id, candidate.organizationId));
  });
}

// The stored-file orphan sweep retries blobs left after the database commit.
async function removeCommittedWorkspaceBlobs(
  workspaceId: string,
  blobs: Array<{ storagePath: string; thumbnailPath: string | null }>,
  deadline: number,
): Promise<void> {
  for (const blob of blobs) {
    for (const pathname of [blob.storagePath, blob.thumbnailPath]) {
      if (Date.now() >= deadline) return;
      if (pathname === null) continue;
      try {
        await deleteBlob(pathname);
      } catch (error) {
        captureException(error, { op: 'purge-workspace-blob', workspaceId, pathname });
      }
    }
  }
}

async function sweepMemberlessOrgs({ cutoff, dryRun, deadline }: SweepRun) {
  const report = emptyResult();
  const qualifies = and(
    lt(organization.createdAt, cutoff),
    sql`not exists (select 1 from ${member} where ${member.organizationId} = ${organization.id})`,
    sql`not exists (select 1 from ${workspace} where ${workspace.organizationId} = ${organization.id})`,
  );
  const candidates = await db
    .select({ id: organization.id })
    .from(organization)
    .where(qualifies)
    .orderBy(sql`${organization.purgeAttemptedAt} asc nulls first`, organization.id)
    .limit(50);
  report.candidates = candidates.length;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (dryRun) continue;
    await purgeCandidate(report, candidate.id, async () => {
      await db
        .update(organization)
        .set({ purgeAttemptedAt: new Date() })
        .where(eq(organization.id, candidate.id));
      const gone = await db
        .delete(organization)
        .where(and(eq(organization.id, candidate.id), qualifies))
        .returning({ id: organization.id });
      if (gone.length > 0) report.deleted += 1;
    });
  }
  return report;
}

const RESTRICT_TABLES = [
  { table: session, col: session.createdByUserId },
  { table: file, col: file.createdByUserId },
  { table: folder, col: folder.createdByUserId },
  { table: folderShare, col: folderShare.createdByUserId },
  { table: sessionShare, col: sessionShare.createdByUserId },
  { table: task, col: task.createdByUserId },
] as const;

async function sweepUsers({ cutoff, dryRun, deadline }: SweepRun) {
  const report = emptyResult();
  const candidates = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        lt(user.deletedAt, cutoff),
        or(
          eq(user.accountStatus, 'deleted'),
          and(
            eq(user.accountStatus, 'anonymized'),
            ...RESTRICT_TABLES.map(
              ({ table, col }) =>
                sql`not exists (select 1 from ${table} where ${col} = ${user.id})`,
            ),
          ),
        ),
      ),
    )
    .orderBy(sql`${user.purgeAttemptedAt} asc nulls first`, user.id)
    .limit(50);
  report.candidates = candidates.length;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    if (dryRun) continue;
    await purgeCandidate(report, candidate.id, async () => {
      await db.update(user).set({ purgeAttemptedAt: new Date() }).where(eq(user.id, candidate.id));
      await db.transaction(async (tx) => {
        await anonymizeAccount(tx, candidate.id, cutoff);
        for (const { table, col } of RESTRICT_TABLES) {
          const rows = await tx.select({ total: count() }).from(table).where(eq(col, candidate.id));
          if (rows.some(({ total }) => total > 0)) {
            report.skipped.push({
              id: candidate.id,
              reason: 'Anonymized identity retained for shared content attribution',
            });
            return;
          }
        }
        if (await purgeAccount(tx, candidate.id, cutoff)) report.deleted += 1;
      });
    });
  }
  return report;
}
