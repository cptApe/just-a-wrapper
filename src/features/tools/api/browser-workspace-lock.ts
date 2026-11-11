import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { ToolError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import 'server-only';
import { browserControlIsLive, LIVE_BROWSER_STATES } from '../lib/browser-machine';
import { workspaceBrowserHolderDecision } from '../lib/browser-reclaim';
import {
  type BrowserCredentials,
  endBrowserSession,
  readBrowserRecord,
  readRemoteSession,
} from './browser-lifecycle';
import { claimIdleBrowser } from './browser-transitions';

// One browser per workspace: busy holders stay; idle holders settle under their own session.
export async function assertWorkspaceBrowserAvailable(
  workspaceId: string,
  sessionRowId: string,
  credentials: BrowserCredentials,
): Promise<void> {
  const holder = (
    await db
      .select({
        id: sessionTable.id,
        status: sessionTable.status,
        browserStatus: sessionTable.browserbaseSessionStatus,
        lease: sessionTable.browserLeaseExpiresAt,
      })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.workspaceId, workspaceId),
          ne(sessionTable.id, sessionRowId),
          inArray(sessionTable.browserbaseSessionStatus, LIVE_BROWSER_STATES),
        ),
      )
      .limit(1)
  ).at(0);
  if (!holder) return;
  if (
    workspaceBrowserHolderDecision({
      ...holder,
      controlledByUser: browserControlIsLive(holder.browserStatus, holder.lease, Date.now()),
    }) === 'busy'
  )
    throwWorkspaceBrowserBusy(workspaceId);
  await reclaimWorkspaceBrowser(credentials, holder.id, workspaceId);
}

// A guarded claim serializes reclaim against a waking holder; settlement bills its identity once.
async function reclaimWorkspaceBrowser(
  credentials: BrowserCredentials,
  holderSessionRowId: string,
  workspaceId: string,
): Promise<void> {
  const holder = await readBrowserRecord(holderSessionRowId);
  if (holder.status !== 'active') return;

  const claimed = await claimIdleBrowser(holderSessionRowId, holder.id);
  if (!claimed) throwWorkspaceBrowserBusy(workspaceId);
  const closing = await readBrowserRecord(holderSessionRowId);
  if (closing.status !== 'closing') throwWorkspaceBrowserBusy(workspaceId);
  const remote = await readRemoteSession(credentials.apiKey, holder.id);
  const { endedAt } = await endBrowserSession(credentials, holderSessionRowId, closing, remote);
  shipLog({
    msg: 'browser.workspace_reclaim',
    feature: 'tooling',
    op: 'browser-workspace-reclaim',
    workspace_id: workspaceId,
    holder_session_id: holderSessionRowId,
    browserbase_session_id: holder.id,
    ended_at: endedAt.toISOString(),
  });
}

export function throwWorkspaceBrowserBusy(workspaceId: string): never {
  throw new ToolError('TOOL_INPUT_INVALID', "Your workspace's browser is busy in another task.", {
    workspaceId,
  });
}
