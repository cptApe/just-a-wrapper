import 'server-only';
import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { browserCandidate, session, workspace } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import {
  BROWSER_ACTION_LEASE_MS,
  BROWSER_CONTROL_LEASE_MS,
  type BrowserStatus,
  browserMachine,
  NEW_BROWSER_SOURCES,
} from '../lib/browser-machine';

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function moveBrowser(
  input: {
    sessionRowId: string;
    browserId: string;
    to: BrowserStatus;
    expected: BrowserStatus;
    lease: Date | null;
    endedAt: Date | null;
  },
  executor: Executor = db,
): Promise<boolean> {
  if (!browserMachine.can(input.expected, input.to)) return false;
  const rows = await executor
    .update(session)
    .set({
      browserbaseSessionStatus: input.to,
      browserbaseSessionEndedAt: input.endedAt,
      browserLeaseExpiresAt:
        input.to === 'acting' || input.to === 'closing'
          ? new Date(Date.now() + BROWSER_ACTION_LEASE_MS)
          : input.to === 'user'
            ? new Date(Date.now() + BROWSER_CONTROL_LEASE_MS)
            : null,
    })
    .where(
      and(
        eq(session.id, input.sessionRowId),
        eq(session.browserbaseSessionId, input.browserId),
        inArray(session.browserbaseSessionStatus, browserMachine.sourcesOf(input.to)),
        eq(session.browserbaseSessionStatus, input.expected),
        input.lease === null ? undefined : eq(session.browserLeaseExpiresAt, input.lease),
      ),
    )
    .returning({ id: session.id });
  return rows.length === 1;
}

export async function expireBrowserControl(sessionRowId: string): Promise<void> {
  const expired = await db
    .update(session)
    .set({ browserbaseSessionStatus: 'active', browserLeaseExpiresAt: null })
    .where(
      and(
        eq(session.id, sessionRowId),
        eq(session.browserbaseSessionStatus, 'user'),
        lte(session.browserLeaseExpiresAt, new Date()),
      ),
    )
    .returning({ anthropicSessionId: session.anthropicSessionId });
  for (const row of expired) {
    if (!row.anthropicSessionId) continue;
    const client = getAnthropicClient();
    if (!client) continue;
    try {
      await client.beta.sessions.events.send(row.anthropicSessionId, {
        events: [
          {
            type: 'user.message',
            content: [
              {
                type: 'text',
                text: '<browser_control state="agent">[Browser control expired; the agent may continue]</browser_control>',
              },
            ],
          },
        ],
      });
    } catch (cause) {
      // Expired user control must not block agent work when the signal transport is down.
      captureException(cause, {
        feature: 'tooling',
        op: 'browser-control-expired-signal',
        sessionRowId,
      });
    }
  }
}

export async function renewBrowserControl(sessionRowId: string): Promise<boolean> {
  const rows = await db
    .update(session)
    .set({ browserLeaseExpiresAt: new Date(Date.now() + BROWSER_CONTROL_LEASE_MS) })
    .where(
      and(
        eq(session.id, sessionRowId),
        eq(session.browserbaseSessionStatus, 'user'),
        gt(session.browserLeaseExpiresAt, new Date()),
      ),
    )
    .returning({ id: session.id });
  return rows.length === 1;
}

// The short transaction checks the fence under the lock; remote work holds a lease, not a DB lock.
export async function withBrowserAction<T>(
  sessionRowId: string,
  browserId: string,
  work: () => Promise<T>,
): Promise<T> {
  await expireBrowserControl(sessionRowId);
  // Leave time for a typed conflict response before the dispatch route deadline.
  const deadline = Date.now() + 240_000;
  let claimed;
  while (!claimed) {
    claimed = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sessionRowId}, 0))`);
      const row = (await tx.select().from(session).where(eq(session.id, sessionRowId))).at(0);
      if (row?.browserbaseSessionId === browserId && row.browserbaseSessionStatus === 'acting')
        return undefined;
      if (
        !row?.browserbaseSessionId ||
        row.browserbaseSessionId !== browserId ||
        row.browserbaseSessionStatus !== 'active'
      )
        throw new ToolError(
          'TOOL_INPUT_INVALID',
          'The browser is not available for an agent action',
          { sessionRowId },
        );
      const moved = await moveBrowser(
        {
          sessionRowId,
          browserId: row.browserbaseSessionId,
          to: 'acting',
          expected: 'active',
          lease: null,
          endedAt: null,
        },
        tx,
      );
      if (!moved)
        throw new ToolError('CONFLICT', 'Browser control changed before the action', {
          sessionRowId,
        });
      return (await tx.select().from(session).where(eq(session.id, sessionRowId))).at(0);
    });
    if (!claimed) {
      if (Date.now() >= deadline)
        throw new ToolError('CONFLICT', 'Browser action wait expired', { sessionRowId });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!claimed.browserbaseSessionId)
    throw new ToolError('CONFLICT', 'Browser action claim disappeared', { sessionRowId });
  try {
    return await work();
  } finally {
    const moved = await moveBrowser({
      sessionRowId,
      browserId: claimed.browserbaseSessionId,
      to: 'active',
      expected: 'acting',
      lease: claimed.browserLeaseExpiresAt,
      endedAt: null,
    });
    if (!moved) {
      const current = (
        await db
          .select({ status: session.browserbaseSessionStatus })
          .from(session)
          .where(eq(session.id, sessionRowId))
      ).at(0);
      if (current?.status !== 'user')
        captureException(
          new ToolError('CONFLICT', 'Browser action lease expired', { sessionRowId }),
          { feature: 'tooling', op: 'browser-action-finalize' },
        );
    }
  }
}

// The session row takes the browser and the candidate row goes in one transaction, so the
// candidate sweep never releases a browser the row owns.
export async function claimBrowser(input: {
  sessionRowId: string;
  browserId: string;
  candidateId: string;
  startedAt: Date;
  url: string;
  title: string;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(session)
      .set({
        browserbaseSessionId: input.browserId,
        browserbaseSessionStatus: 'active',
        browserbaseSessionStartedAt: input.startedAt,
        browserbaseSessionEndedAt: null,
        browserbaseSessionUrl: input.url,
        browserbaseSessionTitle: input.title,
        browserLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(session.id, input.sessionRowId),
          inArray(
            session.workspaceId,
            tx.select({ id: workspace.id }).from(workspace).where(isNull(workspace.deletedAt)),
          ),
          or(
            isNull(session.browserbaseSessionId),
            ne(session.browserbaseSessionId, input.browserId),
          ),
          or(
            isNull(session.browserbaseSessionStatus),
            inArray(session.browserbaseSessionStatus, NEW_BROWSER_SOURCES),
          ),
        ),
      )
      .returning({ id: session.id });
    if (rows.length !== 1) return false;
    await tx.delete(browserCandidate).where(eq(browserCandidate.id, input.candidateId));
    return true;
  });
}

export async function updateBrowserPage(
  sessionRowId: string,
  browserId: string,
  url: string,
  title: string,
): Promise<void> {
  const rows = await db
    .update(session)
    .set({ browserbaseSessionUrl: url, browserbaseSessionTitle: title })
    .where(
      and(
        eq(session.id, sessionRowId),
        eq(session.browserbaseSessionId, browserId),
        eq(session.browserbaseSessionStatus, 'acting'),
      ),
    )
    .returning({ id: session.id });
  if (rows.length === 1) return;
  const current = (
    await db
      .select({ status: session.browserbaseSessionStatus, browserId: session.browserbaseSessionId })
      .from(session)
      .where(eq(session.id, sessionRowId))
  ).at(0);
  if (current?.browserId === browserId && current.status === 'user') return;
  throw new ToolError('CONFLICT', 'Browser page update lost its action lease', { sessionRowId });
}

export async function claimIdleBrowser(sessionRowId: string, browserId: string): Promise<boolean> {
  await expireBrowserControl(sessionRowId);
  return db.transaction(async (tx) => {
    const holder = (
      await tx
        .select({ status: session.status })
        .from(session)
        .where(eq(session.id, sessionRowId))
        .for('update')
    ).at(0);
    if (
      !holder ||
      holder.status === 'running' ||
      holder.status === 'rescheduling' ||
      holder.status === 'requires_input'
    )
      return false;
    return moveBrowser(
      { sessionRowId, browserId, to: 'closing', expected: 'active', lease: null, endedAt: null },
      tx,
    );
  });
}
