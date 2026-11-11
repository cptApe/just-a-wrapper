import 'server-only';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '@/db';
import { browserCandidate, session } from '@/db/schema';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import {
  BROWSER_CANDIDATE_LEASE_MS,
  BROWSER_CANDIDATE_TAG,
  browserCandidateMachine,
} from '../lib/browser-candidate-machine';
import { accrueBrowserTime, type BrowserCredentials } from './browser-lifecycle';
import {
  type BrowserbaseSessionTag,
  isBrowserbaseSessionGone,
  isBrowserbaseSessionMissing,
  listBrowserbaseSessionsByTag,
  releaseBrowserbaseSession,
} from './browserbase-client';

type CandidateTool = (typeof browserCandidate.$inferSelect)['toolName'];

export type BrowserCandidate = {
  id: string;
  sessionRowId: string;
  anthropicSessionId: string;
  toolName: CandidateTool;
  /** The metadata the provider session is created with, so the sweep can find it by id. */
  tag: BrowserbaseSessionTag;
  createdAt: Date;
};

// The intent is on a row before any provider call, so every browser is on a row or swept.
export async function recordBrowserCandidate(input: {
  sessionRowId: string;
  anthropicSessionId: string;
  toolName: CandidateTool;
}): Promise<BrowserCandidate> {
  const row = (
    await db
      .insert(browserCandidate)
      .values({ sessionId: input.sessionRowId, toolName: input.toolName })
      .returning({ id: browserCandidate.id, createdAt: browserCandidate.createdAt })
  ).at(0);
  if (!row)
    throw new IntegrationError('UNEXPECTED', 'Browser candidate was not recorded', {
      sessionRowId: input.sessionRowId,
    });
  return {
    ...input,
    id: row.id,
    createdAt: row.createdAt,
    tag: { [BROWSER_CANDIDATE_TAG]: row.id },
  };
}

export async function markBrowserCandidateCreated(
  candidateId: string,
  browserbaseSessionId: string,
): Promise<void> {
  await db
    .update(browserCandidate)
    .set({ status: 'created', browserbaseSessionId })
    .where(
      and(
        eq(browserCandidate.id, candidateId),
        inArray(browserCandidate.status, browserCandidateMachine.sourcesOf('created')),
      ),
    );
}

/** The browser is owned by the session row or released and billed: nothing is left to track. */
async function dropBrowserCandidate(candidateId: string) {
  await db.delete(browserCandidate).where(eq(browserCandidate.id, candidateId));
}

/** Release and bill a candidate's browser; the candidate is forgotten once nothing runs. */
export async function settleBrowserCandidate(
  credentials: BrowserCredentials,
  candidate: BillableCandidate,
  browserbaseSessionId: string,
): Promise<void> {
  if (await releaseAndBillBrowser(credentials, candidate, browserbaseSessionId))
    await dropBrowserCandidate(candidate.id);
}

type BillableCandidate = Pick<
  BrowserCandidate,
  'id' | 'anthropicSessionId' | 'toolName' | 'createdAt'
>;

// Bills from the provider's own start and end when the release echoes them. A failed release
// still bills the time so far and answers false, so the row stays for the sweep to finish.
async function releaseAndBillBrowser(
  credentials: BrowserCredentials,
  candidate: BillableCandidate,
  browserbaseSessionId: string,
): Promise<boolean> {
  const released = await releaseBrowser(credentials, browserbaseSessionId);
  await accrueBrowserTime({
    anthropicSessionId: candidate.anthropicSessionId,
    browserbaseSessionId,
    toolName: candidate.toolName,
    startedAt: released.startedAt ?? candidate.createdAt,
    endedAt: released.endedAt ?? new Date(),
  });
  return released.done;
}

async function releaseBrowser(
  credentials: BrowserCredentials,
  browserbaseSessionId: string,
): Promise<{ done: boolean; startedAt?: Date; endedAt?: Date }> {
  try {
    const remote = await releaseBrowserbaseSession(
      credentials.apiKey,
      credentials.projectId,
      browserbaseSessionId,
    );
    return {
      done: true,
      startedAt: new Date(remote.startedAt),
      ...(remote.endedAt ? { endedAt: new Date(remote.endedAt) } : {}),
    };
  } catch (cause) {
    captureException(cause, {
      feature: 'tooling',
      op: 'browser-candidate-release',
      browserbaseSessionId,
    });
    // A session the provider no longer has, or one already stopped, is not running.
    return { done: isBrowserbaseSessionMissing(cause) || isBrowserbaseSessionGone(cause) };
  }
}

// Candidates past their lease belong to a process that is gone. Release and bill each provider
// session the session row does not own, then forget the candidate.
export async function reconcileBrowserCandidates(credentials: BrowserCredentials): Promise<void> {
  const stale = await db
    .select({
      candidate: browserCandidate,
      anthropicSessionId: session.anthropicSessionId,
      ownedBrowserId: session.browserbaseSessionId,
    })
    .from(browserCandidate)
    .innerJoin(session, eq(session.id, browserCandidate.sessionId))
    .where(lt(browserCandidate.createdAt, new Date(Date.now() - BROWSER_CANDIDATE_LEASE_MS)))
    .orderBy(asc(browserCandidate.createdAt))
    .limit(25);
  for (const { candidate, anthropicSessionId, ownedBrowserId } of stale) {
    try {
      const browserIds = candidate.browserbaseSessionId
        ? [candidate.browserbaseSessionId]
        : (
            await listBrowserbaseSessionsByTag(credentials.apiKey, {
              key: BROWSER_CANDIDATE_TAG,
              value: candidate.id,
            })
          ).map((remote) => remote.id);
      const orphans = browserIds.filter((id) => id !== ownedBrowserId);
      let done = true;
      for (const browserbaseSessionId of orphans) {
        if (!anthropicSessionId)
          throw new IntegrationError('EXTERNAL_API_FAILED', 'Browser billing session is missing', {
            candidateId: candidate.id,
          });
        const billable = { ...candidate, anthropicSessionId };
        if (!(await releaseAndBillBrowser(credentials, billable, browserbaseSessionId)))
          done = false;
      }
      if (done) await dropBrowserCandidate(candidate.id);
    } catch (cause) {
      captureException(cause, {
        feature: 'tooling',
        op: 'browser-candidate-sweep',
        candidateId: candidate.id,
      });
    }
  }
}
