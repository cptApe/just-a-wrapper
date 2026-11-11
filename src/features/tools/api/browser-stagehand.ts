import 'server-only';
import {
  stagehandCostDeltaMicros,
  stagehandInferenceVendorCostCents,
} from '@/features/billing/lib/browser-session-math';
import { env } from '@/lib/env';
import { IntegrationError, ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import { classifyDocumentLoad, readDocumentProbe } from '../lib/browser-document-load';
import { browserFailureDetail, sanitizeBrowserDetail } from '../lib/browser-failure-detail';
import { STAGEHAND_MODEL } from '../lib/browser-model';
import { blockedTargetReason } from '../lib/url-guard';
import type { BrowserbaseSessionTag } from './browserbase-client';

export const NAVIGATION_TIMEOUT_MS = 30_000;

// Roughly 2k input and 600 output Haiku tokens, charged only if metrics cannot be read.
const STAGEHAND_METRICS_FALLBACK_CENTS = 0.5;

export type StagehandDiagnostics = { lastError?: string };

export function failureDetail(cause: unknown, diagnostics: StagehandDiagnostics): string {
  const chain = browserFailureDetail(cause);
  if (!diagnostics.lastError) return chain;
  return sanitizeBrowserDetail(`${chain} ← ${diagnostics.lastError}`);
}

export async function makeStagehand(input: {
  contextId?: string;
  existingSessionId?: string;
  /** Metadata a new session is created with, so the candidate sweep can find it. */
  tag?: BrowserbaseSessionTag;
  diagnostics: StagehandDiagnostics;
}): Promise<import('@browserbasehq/stagehand').Stagehand> {
  const credentials = browserbaseCapability();
  if (!env.ANTHROPIC_API_KEY) {
    throw new IntegrationError(
      'INTEGRATION_NOT_CONNECTED',
      "The browser's action model isn't available on this deployment",
      {},
    );
  }
  const { Stagehand } = await import('@browserbasehq/stagehand');
  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: credentials.apiKey,
    projectId: credentials.projectId,
    keepAlive: true,
    disablePino: true,
    disableAPI: true,
    verbose: 0,
    // Stagehand throws a bare status after logging its body; retain the upstream detail.
    logger: (line) => {
      if (line.level === 0) {
        input.diagnostics.lastError = `${line.category ?? 'stagehand'}: ${line.message}`;
      }
    },
    model: { modelName: STAGEHAND_MODEL, apiKey: env.ANTHROPIC_API_KEY },
    ...(input.existingSessionId
      ? { browserbaseSessionID: input.existingSessionId }
      : {
          browserbaseSessionCreateParams: {
            projectId: credentials.projectId,
            keepAlive: true,
            timeout: 3600,
            ...(input.tag ? { userMetadata: input.tag } : {}),
            browserSettings: {
              blockAds: true,
              recordSession: true,
              viewport: { width: 1280, height: 800 },
              ...(input.contextId ? { context: { id: input.contextId, persist: true } } : {}),
            },
          },
        }),
  });
  await stagehand.init();
  return stagehand;
}

export async function activePage(stagehand: import('@browserbasehq/stagehand').Stagehand) {
  // activePage is undefined only when every tab of a kept-alive session has been closed.
  return stagehand.context.activePage() ?? stagehand.context.newPage();
}

type StagehandPage = Awaited<ReturnType<typeof activePage>>;

type DocumentLoad = { kind: 'loaded' } | { kind: 'failed' } | { kind: 'unknown'; detail: string };

// Inspect the document, since page.url() keeps failed addresses. An unreadable page is unknown.
export async function inspectDocumentLoad(page: StagehandPage): Promise<DocumentLoad> {
  try {
    const probe = await page.evaluate(readDocumentProbe);
    return { kind: classifyDocumentLoad(probe) };
  } catch (cause) {
    captureException(cause, { feature: 'tooling', op: 'browser-document-probe' });
    return { kind: 'unknown', detail: browserFailureDetail(cause) };
  }
}

export const PAGE_NOT_LOADED_TITLE = 'Page could not be loaded';

export function pageLoadFailedResult(url: string): string {
  return `The browser could not load ${url}: the site did not respond or does not exist.`;
}

export function pageLoadUnknownResult(url: string, detail: string): string {
  return sanitizeBrowserDetail(
    `The browser could not confirm that ${url} loaded (reading the page failed: ${detail}).`,
  );
}

export function assertBrowsableUrl(url: string): void {
  const blocked = blockedTargetReason(url);
  if (blocked)
    throw new ToolError('TOOL_INPUT_INVALID', `Cannot browse that URL: ${blocked}`, { url });
}

const COST_MICROS_PER_CENT = 1_000_000;

export async function stagehandCumulativeCostMicros(
  stagehand: import('@browserbasehq/stagehand').Stagehand,
): Promise<number> {
  return Math.round(
    stagehandInferenceVendorCostCents(await stagehand.metrics) * COST_MICROS_PER_CENT,
  );
}

export type BrowserInference =
  | { kind: 'not_started' }
  | {
      kind: 'started';
      stagehand: import('@browserbasehq/stagehand').Stagehand;
      metricsBeforeMicros: number;
    };

export async function stagehandVendorCostCents(input: BrowserInference): Promise<number> {
  if (input.kind === 'not_started') return 0;
  const fallbackMicros = Math.round(STAGEHAND_METRICS_FALLBACK_CENTS * COST_MICROS_PER_CENT);
  let afterMicros: number | null = null;
  try {
    afterMicros = await stagehandCumulativeCostMicros(input.stagehand);
  } catch (cause) {
    // The action already ran and spent tokens, so unreadable metrics bill the flat estimate.
    captureException(cause, { feature: 'tooling', op: 'stagehand-metrics' });
  }
  const { vendorCostMicros } = stagehandCostDeltaMicros({
    metricsBeforeMicros: input.metricsBeforeMicros,
    metricsAfterMicros: afterMicros,
    fallbackMicros,
  });
  return vendorCostMicros / COST_MICROS_PER_CENT;
}
