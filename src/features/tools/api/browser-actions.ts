import 'server-only';
import { ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import { CHAT_DETAIL_KEY } from '../lib/browser-failure-detail';
import { capBrowseActResult } from '../lib/browser-result';
import {
  endBrowserSession,
  readBrowserRecord,
  readRemoteSession,
  remoteIsLive,
} from './browser-lifecycle';
import {
  activePage,
  assertBrowsableUrl,
  type BrowserInference,
  failureDetail,
  inspectDocumentLoad,
  makeStagehand,
  PAGE_NOT_LOADED_TITLE,
  pageLoadFailedResult,
  pageLoadUnknownResult,
  type StagehandDiagnostics,
  stagehandCumulativeCostMicros,
  stagehandVendorCostCents,
} from './browser-stagehand';
import { updateBrowserPage, withBrowserAction } from './browser-transitions';

type BrowserOperation = {
  instruction: string;
  operation: 'act' | 'extract' | 'observe';
  sessionRowId: string;
};

type BrowserActionResult = {
  success: boolean;
  browserbaseSessionId?: string;
  result: string;
  url?: string;
  title?: string;
  vendorCostCents: number;
};

export async function actInTaskBrowser(input: BrowserOperation): Promise<BrowserActionResult> {
  const record = await readBrowserRecord(input.sessionRowId);
  if (record.status === 'user') {
    return {
      success: false,
      result: 'The user is driving the browser; wait until they hand back control.',
      vendorCostCents: 0,
    };
  }
  const credentials = browserbaseCapability();
  if (record.status !== 'active' && record.status !== 'acting') {
    return {
      success: false,
      result: 'No browser session is open. Call browse_open first.',
      vendorCostCents: 0,
    };
  }
  const remote = await readRemoteSession(credentials.apiKey, record.id);
  if (!remoteIsLive(remote)) {
    await endBrowserSession(credentials, input.sessionRowId, record, remote);
    return {
      success: false,
      browserbaseSessionId: record.id,
      result: 'This browser session ended. Call browse_open to start another one.',
      vendorCostCents: 0,
    };
  }

  return withBrowserAction(input.sessionRowId, record.id, () => runBrowserOperation(input, record));
}

async function runBrowserOperation(
  input: BrowserOperation,
  record: { id: string; url: string | null; title: string | null },
): Promise<BrowserActionResult> {
  let stagehand: import('@browserbasehq/stagehand').Stagehand | undefined;
  let inference: BrowserInference = { kind: 'not_started' };
  const diagnostics: StagehandDiagnostics = {};
  try {
    stagehand = await makeStagehand({ existingSessionId: record.id, diagnostics });
    inference = {
      kind: 'started',
      stagehand,
      metricsBeforeMicros: await stagehandCumulativeCostMicros(stagehand),
    };
    const rendered = await runStagehandOperation(stagehand, input.operation, input.instruction);
    return await reportLandedPage(input.sessionRowId, record.id, inference, rendered);
  } catch (cause) {
    const detail = failureDetail(cause, diagnostics);
    captureException(cause, {
      feature: 'tooling',
      op: `stagehand-${input.operation}`,
      sessionId: record.id,
      [CHAT_DETAIL_KEY]: detail,
    });
    return {
      success: false,
      browserbaseSessionId: record.id,
      result: capBrowseActResult(`The browser action failed: ${detail}`),
      ...(record.url ? { url: record.url } : {}),
      ...(record.title ? { title: record.title } : {}),
      vendorCostCents: await stagehandVendorCostCents(inference),
    };
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

// An operation can navigate anywhere, so check and record where the page ended up.
async function reportLandedPage(
  sessionRowId: string,
  browserId: string,
  inference: Extract<BrowserInference, { kind: 'started' }>,
  rendered: string,
): Promise<BrowserActionResult> {
  const page = await activePage(inference.stagehand);
  const url = page.url();
  try {
    assertBrowsableUrl(url);
  } catch (cause) {
    captureException(cause, {
      feature: 'tooling',
      op: 'browser-post-navigation-guard',
      sessionRowId,
      url,
    });
    await clearBlockedNavigation(page, sessionRowId, browserId);
    return {
      success: false,
      browserbaseSessionId: browserId,
      result:
        cause instanceof ToolError
          ? cause.message
          : 'The browser landed on a blocked address, so the page was cleared.',
      url: 'about:blank',
      title: 'Blocked navigation',
      vendorCostCents: await stagehandVendorCostCents(inference),
    };
  }
  const loaded = await inspectDocumentLoad(page);
  // On a failed load Chrome's page.title() is the bare host, which would
  // read as a real page in the panel header; record the truth instead.
  const title =
    loaded.kind === 'loaded' ? (await page.title()).trim() || url : PAGE_NOT_LOADED_TITLE;
  await updateBrowserPage(sessionRowId, browserId, url, title);
  const vendorCostCents = await stagehandVendorCostCents(inference);
  if (loaded.kind !== 'loaded') {
    return {
      success: false,
      browserbaseSessionId: browserId,
      result:
        loaded.kind === 'failed'
          ? pageLoadFailedResult(url)
          : pageLoadUnknownResult(url, loaded.detail),
      url,
      title,
      vendorCostCents,
    };
  }
  return {
    success: true,
    browserbaseSessionId: browserId,
    result: capBrowseActResult(rendered),
    url,
    title,
    vendorCostCents,
  };
}

async function runStagehandOperation(
  stagehand: import('@browserbasehq/stagehand').Stagehand,
  operation: 'act' | 'extract' | 'observe',
  instruction: string,
): Promise<string> {
  switch (operation) {
    case 'act':
      return JSON.stringify(await stagehand.act(instruction), null, 2);
    case 'extract':
      return JSON.stringify(await stagehand.extract(instruction), null, 2);
    case 'observe':
      return JSON.stringify(await stagehand.observe(instruction), null, 2);
  }
}

async function clearBlockedNavigation(
  page: Awaited<ReturnType<typeof activePage>>,
  sessionRowId: string,
  browserId: string,
): Promise<void> {
  await page.goto('about:blank');
  await updateBrowserPage(sessionRowId, browserId, 'about:blank', 'Blocked navigation');
}
