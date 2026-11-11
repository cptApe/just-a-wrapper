import 'server-only';
import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, workspace } from '@/db/schema';
import { BROWSER_SESSION_MAX_SECONDS } from '@/features/billing/lib/browser-session-math';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { LIVE_BROWSER_STATES } from '../lib/browser-machine';
import { reconcileBrowserCandidates } from './browser-candidates';
import { reconcileBrowserContextCandidates } from './browser-contexts';
import { endBrowserSession, readBrowserRecord, readRemoteSession } from './browser-lifecycle';
import { expireBrowserControl } from './browser-transitions';

// Release and bill at the one-hour cap, and sweep browsers a dead process left on a candidate row,
// so process death cannot make browser usage free.
export async function reconcileTimedOutBrowserSessions(): Promise<void> {
  const credentials = capabilities.browser;
  if (credentials.kind !== 'browserbase') return;
  const cleanup = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(sql`cardinality(${workspace.browserContextCleanupIds}) > 0`)
    .limit(25);
  for (const owner of cleanup) await reconcileBrowserContextCandidates(owner.id);
  await reconcileBrowserCandidates(credentials);
  const cutoff = new Date(Date.now() - BROWSER_SESSION_MAX_SECONDS * 1000);
  const stale = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(
      and(
        inArray(sessionTable.browserbaseSessionStatus, LIVE_BROWSER_STATES),
        isNotNull(sessionTable.browserbaseSessionId),
        isNotNull(sessionTable.browserbaseSessionStartedAt),
        isNotNull(sessionTable.anthropicSessionId),
        or(
          lte(sessionTable.browserbaseSessionStartedAt, cutoff),
          and(
            inArray(sessionTable.browserbaseSessionStatus, ['user', 'acting', 'closing']),
            lte(sessionTable.browserLeaseExpiresAt, new Date()),
          ),
        ),
      ),
    )
    .orderBy(sessionTable.browserbaseSessionStartedAt)
    .limit(25);

  for (const row of stale) {
    try {
      const record = await readBrowserRecord(row.id);
      if (
        record.status === 'active' &&
        record.expiredUserLease !== null &&
        record.startedAt !== null &&
        record.startedAt > cutoff
      ) {
        await expireBrowserControl(row.id);
        continue;
      }
      if (
        record.status === null ||
        record.status === 'closed' ||
        record.status === 'ended' ||
        !record.startedAt
      )
        continue;
      const remote = await readRemoteSession(credentials.apiKey, record.id);
      await endBrowserSession(credentials, row.id, record, remote);
    } catch (error) {
      captureException(error, {
        feature: 'tooling',
        op: 'browser-session-timeout-sweep',
        sessionId: row.id,
      });
    }
  }
}

export async function releaseWorkspaceBrowsers(workspaceId: string): Promise<void> {
  const credentials = capabilities.browser;
  if (credentials.kind !== 'browserbase') return;
  const rows = await db
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.workspaceId, workspaceId),
        inArray(sessionTable.browserbaseSessionStatus, LIVE_BROWSER_STATES),
      ),
    );
  for (const row of rows) {
    try {
      const record = await readBrowserRecord(row.id);
      if (record.status === null || record.status === 'closed' || record.status === 'ended')
        continue;
      const remote = await readRemoteSession(credentials.apiKey, record.id);
      await endBrowserSession(credentials, row.id, record, remote);
    } catch (cause) {
      captureException(cause, {
        feature: 'tooling',
        op: 'workspace-browser-cleanup',
        sessionId: row.id,
      });
    }
  }
}
