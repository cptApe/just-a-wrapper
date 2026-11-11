import 'server-only';
import type { Browser, Page } from 'playwright-core';
import { z } from 'zod';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import type { CustomTool, ToolContext } from '@/features/tool-catalog/types';
import { BROWSE_PAGE_DECL } from '@/features/tool-catalog/web-declarations';
import { IntegrationError, ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import {
  markBrowserCandidateCreated,
  recordBrowserCandidate,
  settleBrowserCandidate,
} from '../api/browser-candidates';
import { assertBrowsableUrl } from '../api/browser-stagehand';
import { createBrowserbaseSession } from '../api/browserbase-client';
import { readDocumentBodyText, settlePageText } from '../lib/page-text-settle';
import { blockedTargetReason } from '../lib/url-guard';
import { browserStartEstimateCredits } from '../lib/vendor-estimates';

// Create a Browserbase session, read the page through CDP and release the session.
// Reject private, loopback, link-local and non-web targets before navigation.
// The browser bills like every other browser use: through a candidate row, at the provider's
// one-minute minimum, whether the read succeeds or fails.
// Capture a viewport JPEG and save it to Library best-effort; text survives image failure.
// Load playwright-core dynamically so unrelated tools avoid the browser client dependency.

// This module loads only for a declared tool; capture its provider credentials once.
const credentials = browserbaseCapability();

// Browserbase ends an idle one-shot session after this many seconds.
const PAGE_SESSION_TIMEOUT_SECONDS = 120;
// Extracted text is capped so a huge page can't blow the tool result payload.
const MAX_PAGE_CHARS = 10_000;
// URL length ceiling (a hair over the de-facto browser limit of 2048).
const MAX_URL_CHARS = 2048;
// Page-load ceiling — a slow page fails cleanly instead of holding the session.
const NAV_TIMEOUT_MS = 30_000;
// SPA render settling is additive to navigation and deliberately small. Exact
// text must repeat twice; thin pre-render shells do not count as settled.
const RENDER_SETTLE_BUDGET_MS = 5_000;
const RENDER_SAMPLE_INTERVAL_MS = 500;
const MIN_MEANINGFUL_PAGE_CHARS = 100;
// Where page snapshots land in the Library (mirrors generate_image's
// /Generated images). One durable JPEG per successful browse, when capture and
// upload both succeed.
const PAGE_SNAPSHOTS_FOLDER = '/Page snapshots';
// A viewport JPEG is plenty for a card thumbnail; quality trades a little
// fidelity for a much smaller upload.
const SCREENSHOT_JPEG_QUALITY = 70;

const input = z.object({ url: z.string().url().max(MAX_URL_CHARS) });

const output = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  /** True when the page text was longer than MAX_PAGE_CHARS and was clipped. */
  truncated: z.boolean(),
  /**
   * Viewport screenshot saved to the Library, present ONLY when both capture
   * and persistence succeeded. Absent degrades the card to text-only — a
   * screenshot failure never fails the browse. The card reads this from the
   * same posted result the agent does.
   */
  screenshot: z.object({ url: z.string(), width: z.number(), height: z.number() }).optional(),
  /** The Browserbase session this browse ran in; the replay routes read it. */
  browserbaseSessionId: z.string(),
});

type PageRead = Awaited<ReturnType<typeof readBrowserPage>>;

export const browsePageTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...BROWSE_PAGE_DECL,
  inputSchema: input,
  outputSchema: output,
  estimateCredits: browserStartEstimateCredits,
  async handler({ url }, ctx) {
    // SSRF gate first: the browser runs on Browserbase's network, so this holds before navigation.
    const blocked = blockedTargetReason(url);
    if (blocked) {
      throw new ToolError('TOOL_INPUT_INVALID', `Cannot browse that URL: ${blocked}`, { url });
    }

    // Load the CDP client before the session exists, so an import failure strands nothing.
    const { chromium } = await import('playwright-core');

    const candidate = await recordBrowserCandidate({
      sessionRowId: ctx.sessionRowId,
      anthropicSessionId: ctx.sessionId,
      toolName: 'browse_page',
    });
    const session = await createBrowserbaseSession({
      apiKey: credentials.apiKey,
      projectId: credentials.projectId,
      timeoutSeconds: PAGE_SESSION_TIMEOUT_SECONDS,
      tag: candidate.tag,
    });
    await markBrowserCandidateCreated(candidate.id, session.id);

    // Release and bill before the upload, so upload latency never counts as browser time.
    let read: PageRead;
    try {
      read = await connectAndRead(chromium, session, url);
    } finally {
      await settleBrowserCandidate(credentials, candidate, session.id);
    }
    const screenshot = read.shot ? await saveSnapshot(read.shot, url, ctx, session.id) : undefined;

    return {
      ...read.page,
      ...(screenshot ? { screenshot } : {}),
      browserbaseSessionId: session.id,
    };
  },
};

async function connectAndRead(
  chromium: { connectOverCDP(endpoint: string): Promise<Browser> },
  session: { id: string; connectUrl: string },
  url: string,
): Promise<PageRead> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not connect to the Browserbase session',
      { sessionId: session.id },
      { cause },
    );
  }
  try {
    return await readBrowserPage(browser, url, session.id);
  } finally {
    try {
      await browser.close();
    } catch (cause) {
      captureException(cause, {
        feature: 'tooling',
        op: 'browserbase-close',
        sessionId: session.id,
      });
    }
  }
}

/** "https://www.lrt.lt/en/news" → "lrt-lt.jpg" — a readable snapshot name;
 *  importDriveFile collision-proofs it with a short random suffix. */
function snapshotFilename(url: string): string {
  const host = URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : 'page';
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'page'}.jpg`;
}

type Snapshot = { bytes: Uint8Array<ArrayBuffer>; width: number; height: number };

// Thumbnail failures leave the useful page text available.
async function captureSnapshot(tab: Page, sessionId: string): Promise<Snapshot | undefined> {
  try {
    const raw = await tab.screenshot({ type: 'jpeg', quality: SCREENSHOT_JPEG_QUALITY });
    const dims = await tab.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));
    return { bytes: new Uint8Array(raw), ...dims };
  } catch (cause) {
    captureException(cause, { feature: 'tooling', op: 'browserbase-screenshot', sessionId });
    return undefined;
  }
}

async function readBrowserPage(browser: Browser, url: string, sessionId: string) {
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const tab = context.pages()[0] ?? (await context.newPage());
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    assertBrowsableUrl(tab.url());
    const title = await tab.title();
    const bodyText = await settlePageText({
      sample: () => tab.evaluate(readDocumentBodyText),
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      now: Date.now,
      budgetMs: RENDER_SETTLE_BUDGET_MS,
      intervalMs: RENDER_SAMPLE_INTERVAL_MS,
      minMeaningfulChars: MIN_MEANINGFUL_PAGE_CHARS,
    });
    const clean = bodyText.replace(/\n{3,}/g, '\n\n').trim();
    const truncated = clean.length > MAX_PAGE_CHARS;
    return {
      page: {
        url,
        title: title.trim() || url,
        text: truncated ? `${clean.slice(0, MAX_PAGE_CHARS).trimEnd()}…` : clean,
        truncated,
      },
      shot: await captureSnapshot(tab, sessionId),
    };
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not load the page',
      { url },
      { cause },
    );
  }
}

// Upload failures leave the result text-only; upload time never counts as browser usage.
async function saveSnapshot(shot: Snapshot, url: string, ctx: ToolContext, sessionId: string) {
  try {
    const saved = await importDriveFile({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      bytes: shot.bytes,
      filename: snapshotFilename(url),
      mimeType: 'image/jpeg',
      folderPath: PAGE_SNAPSHOTS_FOLDER,
      source: 'agent_generated',
      sessionId: ctx.sessionRowId,
    });
    return { url: saved.url, width: shot.width, height: shot.height };
  } catch (cause) {
    captureException(cause, { feature: 'tooling', op: 'browserbase-snapshot-save', sessionId });
    return undefined;
  }
}
