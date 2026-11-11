import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { accrueToolCall } from '@/features/billing/api/accrue-tool-call';
import {
  browserSessionBillingKey,
  browserSessionVendorCostCents,
  cappedBrowserSessionEnd,
} from '@/features/billing/lib/browser-session-math';
import type { Capabilities } from '@/lib/capabilities';
import { IntegrationError, ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { type BrowserStatus, browserControlIsLive } from '../lib/browser-machine';
import { expireBrowserControl, moveBrowser } from './browser-transitions';
import {
  type BrowserbaseRemoteSession,
  getBrowserbaseSession,
  isBrowserbaseSessionGone,
  isBrowserbaseSessionLive,
  isBrowserbaseSessionMissing,
  releaseBrowserbaseSession,
} from './browserbase-client';

type LeasedBrowserStatus = 'user' | 'acting' | 'closing';

// Mirrors session_browser_lease_check: only user, acting and closing carry a lease.
export type BrowserRecord = {
  anthropicSessionId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  url: string | null;
  title: string | null;
} & (
  | { status: null; id: null }
  // An expired user lease already reads as agent control; expireBrowserControl releases the row.
  | { status: 'active'; id: string; expiredUserLease: Date | null }
  | { status: LeasedBrowserStatus; id: string; leaseExpiresAt: Date }
  | { status: 'closed' | 'ended'; id: string }
);

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function readBrowserRecord(
  sessionRowId: string,
  executor: DbExecutor = db,
): Promise<BrowserRecord> {
  const row = (
    await executor
      .select({
        id: sessionTable.browserbaseSessionId,
        anthropicSessionId: sessionTable.anthropicSessionId,
        status: sessionTable.browserbaseSessionStatus,
        startedAt: sessionTable.browserbaseSessionStartedAt,
        endedAt: sessionTable.browserbaseSessionEndedAt,
        url: sessionTable.browserbaseSessionUrl,
        title: sessionTable.browserbaseSessionTitle,
        leaseExpiresAt: sessionTable.browserLeaseExpiresAt,
      })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionRowId))
      .limit(1)
  ).at(0);
  if (!row) throw new ToolError('SESSION_NOT_FOUND', 'Session not found', { sessionRowId });
  const { id, status, leaseExpiresAt, ...page } = row;
  if (status === null) return { ...page, status: null, id: null };
  // Browser creation persists status and id in one update; settlement retains the id.
  // Reject inconsistent stored rows at this boundary before remote calls or billing.
  if (!id)
    throw new ToolError('UNEXPECTED', 'Browser status requires a Browserbase session id', {
      sessionRowId,
      status,
    });
  if (status === 'active') return { ...page, status, id, expiredUserLease: null };
  if (status === 'closed' || status === 'ended') return { ...page, status, id };
  if (!leaseExpiresAt)
    throw new ToolError('UNEXPECTED', 'Browser status requires a lease', { sessionRowId, status });
  if (status === 'user' && !browserControlIsLive(status, leaseExpiresAt, Date.now()))
    return { ...page, status: 'active', id, expiredUserLease: leaseExpiresAt };
  return { ...page, status, id, leaseExpiresAt };
}

// Bill to the remote end or persisted start, never through scheduler lag.
function terminalEndFromRemote(
  remote: BrowserbaseRemoteSession | null,
  startedAt: Date | null,
): Date {
  if (remote?.endedAt) return new Date(remote.endedAt);
  if (!remote) return startedAt ?? new Date();
  const expiresAt = remote.expiresAt ? new Date(remote.expiresAt).getTime() : Date.now();
  return new Date(Math.min(Date.now(), expiresAt));
}

export async function readRemoteSession(
  apiKey: string,
  sessionId: string,
): Promise<BrowserbaseRemoteSession | null> {
  try {
    return await getBrowserbaseSession(apiKey, sessionId);
  } catch (cause) {
    // A remote 404 is terminal, not a tool failure.
    if (!isBrowserbaseSessionMissing(cause)) throw cause;
    captureException(cause, {
      feature: 'tooling',
      op: 'browser-session-missing',
      browserbaseSessionId: sessionId,
    });
    return null;
  }
}

export function remoteIsLive(
  remote: BrowserbaseRemoteSession | null,
): remote is BrowserbaseRemoteSession {
  return remote !== null && isBrowserbaseSessionLive(remote);
}

export type BrowserCredentials = Extract<Capabilities['browser'], { kind: 'browserbase' }>;

async function releaseRemoteSession(
  credentials: BrowserCredentials,
  sessionId: string,
): Promise<BrowserbaseRemoteSession | null> {
  try {
    return await releaseBrowserbaseSession(credentials.apiKey, credentials.projectId, sessionId);
  } catch (cause) {
    // Neither 404 nor 410 may prevent settlement.
    if (!isBrowserbaseSessionMissing(cause) && !isBrowserbaseSessionGone(cause)) throw cause;
    captureException(cause, {
      feature: 'tooling',
      op: 'browser-session-release-unknown',
      browserbaseSessionId: sessionId,
    });
    return null;
  }
}

// Null reads still release: a transient 404 must not leave a paid RUNNING browser.
// Prefer Browserbase's release timestamp for billing when it is present.
export async function endRemoteSession(
  credentials: BrowserCredentials,
  record: { id: string; startedAt: Date | null },
  remote: BrowserbaseRemoteSession | null,
): Promise<{ candidateEndedAt: Date; closedByUs: boolean }> {
  if (remote !== null && !isBrowserbaseSessionLive(remote)) {
    return { candidateEndedAt: terminalEndFromRemote(remote, record.startedAt), closedByUs: false };
  }
  const released = await releaseRemoteSession(credentials, record.id);
  if (released?.endedAt) {
    return { candidateEndedAt: new Date(released.endedAt), closedByUs: remote !== null };
  }
  if (remote !== null) return { candidateEndedAt: new Date(), closedByUs: true };
  return { candidateEndedAt: terminalEndFromRemote(null, record.startedAt), closedByUs: false };
}

export async function settleActiveBrowserSession(input: {
  sessionRowId: string;
  record: BrowserRecord & { status: BrowserStatus };
  candidateEndedAt: Date;
  status: 'closed' | 'ended';
}): Promise<{ durationSeconds: number; vendorCostCents: number; endedAt: Date }> {
  const { record } = input;
  if (!record.startedAt || !record.anthropicSessionId) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Browser billing metadata is incomplete', {
      sessionRowId: input.sessionRowId,
      browserbaseSessionId: record.id,
    });
  }
  // One durable billing owner for explicit close, remote terminal discovery and the timeout sweep.
  const billed = await accrueBrowserTime({
    anthropicSessionId: record.anthropicSessionId,
    browserbaseSessionId: record.id,
    toolName: 'browse_close',
    startedAt: record.startedAt,
    endedAt: input.candidateEndedAt,
  });
  const { endedAt } = billed;
  if (record.status === 'active' && record.expiredUserLease !== null)
    await expireBrowserControl(input.sessionRowId);
  const moved = await moveBrowser({
    sessionRowId: input.sessionRowId,
    browserId: record.id,
    to: input.status,
    expected: record.status,
    lease: 'leaseExpiresAt' in record ? record.leaseExpiresAt : null,
    endedAt,
  });
  if (!moved)
    throw new ToolError('CONFLICT', 'Browser settlement lost its claim', {
      sessionRowId: input.sessionRowId,
    });
  return billed;
}

/** End a browser the row still holds and bill it, releasing it upstream if it still runs. */
export async function endBrowserSession(
  credentials: BrowserCredentials,
  sessionRowId: string,
  record: BrowserRecord & { status: BrowserStatus },
  remote: BrowserbaseRemoteSession | null,
): Promise<{ durationSeconds: number; vendorCostCents: number; endedAt: Date }> {
  const { candidateEndedAt } = await endRemoteSession(credentials, record, remote);
  return settleActiveBrowserSession({ sessionRowId, record, candidateEndedAt, status: 'ended' });
}

export type BrowserBillingTool = 'browse_open' | 'browse_page' | 'browse_close';

// The one place browser time becomes a charge: the provider's minimum and the one-hour cap apply,
// and the Browserbase id is the usage key, so every retry and every sweep bills a browser once.
export async function accrueBrowserTime(input: {
  anthropicSessionId: string;
  browserbaseSessionId: string;
  toolName: BrowserBillingTool;
  startedAt: Date;
  endedAt: Date;
}): Promise<{ durationSeconds: number; vendorCostCents: number; endedAt: Date }> {
  const endedAt = cappedBrowserSessionEnd(input.startedAt, input.endedAt);
  const durationSeconds = (endedAt.getTime() - input.startedAt.getTime()) / 1000;
  const vendorCostCents = browserSessionVendorCostCents(durationSeconds);
  await accrueToolCall({
    anthropicSessionId: input.anthropicSessionId,
    toolUseId: browserSessionBillingKey(input.browserbaseSessionId),
    toolName: input.toolName,
    vendorCostCents,
    source: 'tool_call',
  });
  return { durationSeconds, vendorCostCents, endedAt };
}
