import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { integration, workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { sweepDeadline } from '@/lib/sweep-deadline';
import { disconnectToolkitAccounts } from '../composio/disconnect';
import { beginConnectionDisconnect, finishConnectionDisconnect } from './connection-transitions';

export async function recoverConnectionDisconnects() {
  const deadline = sweepDeadline();
  const report = { completed: 0, failed: 0 };
  const { connectedApps } = capabilities;
  if (connectedApps.kind === 'off') return report;
  const candidates = await db
    .select({
      workspaceId: integration.workspaceId,
      userId: integration.userId,
      toolkit: integration.toolkit,
      composioUserId: workspaceMember.composioUserId,
    })
    .from(integration)
    .innerJoin(workspace, and(eq(workspace.id, integration.workspaceId), workspaceNotDeleted))
    .innerJoin(
      workspaceMember,
      and(
        eq(workspaceMember.organizationId, workspace.organizationId),
        eq(workspaceMember.userId, integration.userId),
      ),
    )
    .where(
      and(
        eq(integration.status, 'disconnecting'),
        lt(integration.observedAt, new Date(Date.now() - 300_000)),
      ),
    )
    .orderBy(integration.observedAt)
    .limit(50);
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    const claimedAt = await beginConnectionDisconnect(candidate);
    if (claimedAt === null) continue;
    try {
      await disconnectToolkitAccounts(
        candidate.composioUserId,
        connectedApps.apiKey,
        candidate.toolkit,
      );
      if (!(await finishConnectionDisconnect({ ...candidate, claimedAt })))
        throw new AppError('CONFLICT', 'Disconnect recovery lost its claim', candidate);
      report.completed += 1;
    } catch (error) {
      captureException(error, { op: 'recover-connection-disconnect', ...candidate });
      report.failed += 1;
    }
  }
  return report;
}
