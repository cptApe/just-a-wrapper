import 'server-only';
import { BillingError, IntegrationError, ToolError } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/is-unique-violation';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import { CHAT_DETAIL_KEY, sanitizeBrowserDetail } from '../lib/browser-failure-detail';
import { resolveBrowserSessionClaim } from '../lib/browser-session-claim';
import {
  markBrowserCandidateCreated,
  recordBrowserCandidate,
  settleBrowserCandidate,
} from './browser-candidates';
import { ensureMemberBrowserContext } from './browser-contexts';
import {
  endBrowserSession,
  endRemoteSession,
  readBrowserRecord,
  readRemoteSession,
  remoteIsLive,
  settleActiveBrowserSession,
} from './browser-lifecycle';
import {
  activePage,
  assertBrowsableUrl,
  failureDetail,
  inspectDocumentLoad,
  makeStagehand,
  NAVIGATION_TIMEOUT_MS,
  pageLoadUnknownResult,
  type StagehandDiagnostics,
} from './browser-stagehand';
import {
  claimBrowser,
  moveBrowser,
  updateBrowserPage,
  withBrowserAction,
} from './browser-transitions';
import {
  assertWorkspaceBrowserAvailable,
  throwWorkspaceBrowserBusy,
} from './browser-workspace-lock';

export async function openTaskBrowser(input: {
  url: string;
  workspaceId: string;
  userId: string;
  sessionRowId: string;
}) {
  const record = await readBrowserRecord(input.sessionRowId);
  if (record.status === 'active' || record.status === 'acting' || record.status === 'user') {
    const credentials = browserbaseCapability();
    const remote = await readRemoteSession(credentials.apiKey, record.id);
    if (remoteIsLive(remote))
      return withBrowserAction(input.sessionRowId, record.id, () => openBrowser(input, record.id));
    await endBrowserSession(credentials, input.sessionRowId, record, remote);
  }
  return openBrowser(input, undefined);
}

type OpenInput = { url: string; workspaceId: string; userId: string; sessionRowId: string };
type OpenedBrowser = { browserbaseSessionId: string; url: string; title: string; reused: boolean };
type Stagehand = import('@browserbasehq/stagehand').Stagehand;

async function openBrowser(
  input: OpenInput,
  existingSessionId: string | undefined,
): Promise<OpenedBrowser> {
  assertBrowsableUrl(input.url);
  if (existingSessionId) return navigateBrowser(input, existingSessionId);
  return openNewBrowser(input);
}

async function navigateBrowser(input: OpenInput, browserId: string): Promise<OpenedBrowser> {
  const diagnostics: StagehandDiagnostics = {};
  return withStagehand(
    { existingSessionId: browserId, diagnostics },
    input.url,
    async (stagehand) => {
      const page = await loadedPage(stagehand, input.url);
      await updateBrowserPage(input.sessionRowId, browserId, page.url, page.title);
      return { browserbaseSessionId: browserId, ...page, reused: true };
    },
  );
}

// The candidate row is written before the provider create, so a process killed at any point
// leaves a row the timeout sweep releases and bills.
async function openNewBrowser(input: OpenInput): Promise<OpenedBrowser> {
  const credentials = browserbaseCapability();
  const existing = await readBrowserRecord(input.sessionRowId);
  if (existing.status === 'acting')
    throw new ToolError('CONFLICT', 'The browser ended while opening the page; open it again', {
      sessionRowId: input.sessionRowId,
    });
  if (!existing.anthropicSessionId)
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Browser billing session is missing', {
      sessionRowId: input.sessionRowId,
    });
  await assertWorkspaceBrowserAvailable(input.workspaceId, input.sessionRowId, credentials);
  const contextId = await ensureMemberBrowserContext(input.workspaceId, input.userId);
  const candidate = await recordBrowserCandidate({
    sessionRowId: input.sessionRowId,
    anthropicSessionId: existing.anthropicSessionId,
    toolName: 'browse_open',
  });
  // Once owned by the row or released, the browser must not be released again.
  const progress: { browserId?: string; settled: boolean } = { settled: false };
  const release = async (id: string) => {
    progress.settled = true;
    await settleBrowserCandidate(credentials, candidate, id);
  };
  const diagnostics: StagehandDiagnostics = {};
  try {
    return await withStagehand(
      { contextId, tag: candidate.tag, diagnostics },
      input.url,
      async (stagehand) => {
        const sessionId = stagehand.browserbaseSessionID;
        if (!sessionId)
          throw new IntegrationError(
            'EXTERNAL_API_FAILED',
            'The browser service did not return a session id',
            {},
          );
        progress.browserId = sessionId;
        await markBrowserCandidateCreated(candidate.id, sessionId);
        const page = await loadedPage(stagehand, input.url);
        const resolution = await claimNewBrowserSession({
          ...input,
          ...page,
          sessionId,
          candidateId: candidate.id,
          startedAt: await readBillingStart(credentials.apiKey, sessionId),
          releaseCandidate: () => release(sessionId),
        });
        if (resolution.claimed) {
          progress.settled = true;
          return { browserbaseSessionId: sessionId, ...page, reused: false };
        }
        if (resolution.winner)
          return {
            browserbaseSessionId: resolution.winner.id,
            url: resolution.winner.url,
            title: resolution.winner.title,
            reused: true,
          };
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Could not claim the task browser session',
          {
            sessionRowId: input.sessionRowId,
          },
        );
      },
    );
  } catch (cause) {
    // Release a failed open before reporting its error, so it cannot keep burning browser time.
    if (progress.browserId && !progress.settled)
      await releaseFailedOpen(release, progress.browserId);
    throw cause;
  }
}

// A billing failure must surface; a failed release stays on the candidate row for the sweep.
async function releaseFailedOpen(
  release: (browserId: string) => Promise<void>,
  browserId: string,
): Promise<void> {
  try {
    await release(browserId);
  } catch (cause) {
    captureException(cause, { feature: 'tooling', op: 'browser-session-create-cleanup' });
    if (cause instanceof BillingError) throw cause;
  }
}

async function withStagehand<T>(
  options: Parameters<typeof makeStagehand>[0],
  url: string,
  work: (stagehand: Stagehand) => Promise<T>,
): Promise<T> {
  let stagehand: Stagehand | undefined;
  try {
    stagehand = await makeStagehand(options);
    return await work(stagehand);
  } catch (cause) {
    throw asOpenBrowserError(cause, url, options.diagnostics);
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (cause) {
        captureException(cause, { feature: 'tooling', op: 'stagehand-disconnect' });
      }
    }
  }
}

async function loadedPage(stagehand: Stagehand, requestedUrl: string) {
  const page = await activePage(stagehand);
  await loadPageOrThrow(page, requestedUrl);
  return { title: (await page.title()).trim() || requestedUrl, url: page.url() || requestedUrl };
}

function asOpenBrowserError(
  cause: unknown,
  url: string,
  diagnostics: StagehandDiagnostics,
): ToolError | IntegrationError {
  if (cause instanceof ToolError || cause instanceof IntegrationError) return cause;
  return new IntegrationError(
    'EXTERNAL_API_FAILED',
    'Could not open the browser page',
    { url, [CHAT_DETAIL_KEY]: failureDetail(cause, diagnostics) },
    { cause },
  );
}

async function loadPageOrThrow(
  page: Awaited<ReturnType<typeof activePage>>,
  url: string,
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeoutMs: NAVIGATION_TIMEOUT_MS });
  const loaded = await inspectDocumentLoad(page);
  if (loaded.kind === 'failed') {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'The browser could not load that page', {
      url,
      [CHAT_DETAIL_KEY]: sanitizeBrowserDetail(
        `Chrome showed "This site can't be reached" for ${url}: the site did not respond or does not exist`,
      ),
    });
  }
  if (loaded.kind === 'unknown') {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'The browser could not confirm the page loaded',
      { url, [CHAT_DETAIL_KEY]: pageLoadUnknownResult(url, loaded.detail) },
    );
  }
  try {
    assertBrowsableUrl(page.url());
  } catch (cause) {
    await page.goto('about:blank');
    throw cause;
  }
}

// Browserbase's own start time is the billing start. Its record can lag right after create,
// and the moment of the successful open is close enough to never fail a working session.
async function readBillingStart(apiKey: string, browserId: string): Promise<Date> {
  const created = await readRemoteSession(apiKey, browserId);
  return created ? new Date(created.startedAt) : new Date();
}

export async function closeTaskBrowser(sessionRowId: string): Promise<{
  success: boolean;
  browserbaseSessionId?: string;
  durationSeconds: number;
  vendorCostCents: number;
  message: string;
}> {
  const credentials = browserbaseCapability();
  const record = await readBrowserRecord(sessionRowId);
  if (record.status === 'user' || record.status === 'acting' || record.status === 'closing')
    throw new ToolError('CONFLICT', 'The browser is controlled or busy', { sessionRowId });
  if (record.status !== 'active' || !record.startedAt) {
    return {
      success: false,
      durationSeconds: 0,
      vendorCostCents: 0,
      message: 'No browser session is open.',
    };
  }
  const claimed = await moveBrowser({
    sessionRowId,
    browserId: record.id,
    to: 'closing',
    expected: 'active',
    lease: null,
    endedAt: null,
  });
  if (!claimed)
    throw new ToolError('CONFLICT', 'The browser is controlled or busy', { sessionRowId });
  const closingRecord = await readBrowserRecord(sessionRowId);
  if (closingRecord.status !== 'closing')
    throw new ToolError('CONFLICT', 'Browser close claim disappeared', { sessionRowId });
  const remote = await readRemoteSession(credentials.apiKey, record.id);
  const { candidateEndedAt, closedByUs } = await endRemoteSession(credentials, record, remote);
  const status: 'closed' | 'ended' = closedByUs ? 'closed' : 'ended';
  const { durationSeconds, vendorCostCents } = await settleActiveBrowserSession({
    sessionRowId,
    record: closingRecord,
    candidateEndedAt,
    status,
  });
  return {
    success: true,
    browserbaseSessionId: record.id,
    durationSeconds,
    vendorCostCents,
    message: `Closed the browser after ${Math.max(1, Math.round(durationSeconds))} seconds. Browser usage was added to this task.`,
  };
}

async function claimNewBrowserSession(input: {
  sessionRowId: string;
  workspaceId: string;
  sessionId: string;
  candidateId: string;
  startedAt: Date;
  url: string;
  title: string;
  releaseCandidate: () => Promise<void>;
}) {
  const { sessionId, startedAt, url, title } = input;
  return resolveBrowserSessionClaim({
    candidateId: sessionId,
    async claim() {
      try {
        return await claimBrowser({
          sessionRowId: input.sessionRowId,
          browserId: sessionId,
          candidateId: input.candidateId,
          startedAt,
          url,
          title,
        });
      } catch (cause) {
        if (isUniqueViolation(cause)) throwWorkspaceBrowserBusy(input.workspaceId);
        throw cause;
      }
    },
    releaseCandidate: input.releaseCandidate,
    async readWinner() {
      const winner = await readBrowserRecord(input.sessionRowId);
      // The claim writes the status, URL and title together, so an active row has all three.
      return winner.status === 'active' && winner.url !== null && winner.title !== null
        ? { id: winner.id, url: winner.url, title: winner.title }
        : null;
    },
  });
}
