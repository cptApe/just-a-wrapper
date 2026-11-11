import 'server-only';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { z } from 'zod';
import { requireAnthropicClient } from '@/features/agents';
import { AppError, IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import {
  BROWSERBASE_API_BASE,
  parseReplayMetadata,
  type ReplayMetadata,
  recordedBrowserbaseSessionIds,
} from '../lib/browse-replay';

// Server proxy for Browserbase session replays.
// The browser NEVER holds the Browserbase key: these functions fetch with
// `X-BB-API-Key` and hand back shaped metadata / the raw HLS manifest, exactly
// as the artifact byte proxy fronts the Files API with our credentials. The
// route boundary owns the workspace ownership gate; this module only talks to
// Browserbase.

// A hung Browserbase call should fail the request loudly, not park the browser's
// replay spinner — the SDK-less fetch has no default timeout of its own.
const REPLAY_TIMEOUT_MS = 20_000;

// The binding scan reads the session's own event history to prove a `bb` id
// belongs to it. Cap the scan (same ceiling the relay uses) so a pathologically
// long session can't turn one replay click into an unbounded list, and give the
// list request the same explicit timeout the other event-list callers use.
const MAX_BINDING_SCAN_EVENTS = 1000;
const EVENTS_LIST_TIMEOUT_MS = 30_000;

/**
 * Assert that `browserbaseSessionId` was actually recorded by a browse_page call
 * inside session `anthropicSessionId` — the ownership tie for the replay routes.
 * The routes authorize OUR `session.id`, but the `bb` query param arrives
 * unverified: without this, a workspace member could pair their own owned
 * session with a foreign Browserbase id and replay someone else's browsing.
 *
 * The proof is server-side: no cheaper store exists (browserbaseSessionId is
 * never mirrored to our DB — the artifact sweep persists only Files-API outputs,
 * not the browse's Browserbase id), so we read the session's own recorded
 * results from the Managed Sessions Events API — the same authoritative source
 * the transcript and artifact sweep read from — and require the id to appear
 * among them. Throws `SESSION_NOT_FOUND` on a miss so the routes collapse it to
 * the same 404 as a foreign/unknown session and never leak which ids exist.
 */
export async function assertBrowseSessionRecorded(input: {
  anthropicSessionId: string;
  browserbaseSessionId: string;
}): Promise<void> {
  const client = requireAnthropicClient();

  const events: BetaManagedAgentsSessionEvent[] = [];
  for await (const event of client.beta.sessions.events.list(input.anthropicSessionId, null, {
    timeout: EVENTS_LIST_TIMEOUT_MS,
  })) {
    events.push(event);
    if (events.length >= MAX_BINDING_SCAN_EVENTS) break;
  }

  const recorded = recordedBrowserbaseSessionIds(events, parseCustomToolResult);
  if (!recorded.has(input.browserbaseSessionId)) {
    throw new AppError('SESSION_NOT_FOUND', 'Session not found', {
      anthropicSessionId: input.anthropicSessionId,
      browserbaseSessionId: input.browserbaseSessionId,
    });
  }
}

/**
 * Parse one custom-tool-result text block into its object, or null when it isn't
 * a JSON object. A browse_page result we recorded is always valid JSON we wrote,
 * so a malformed block is a genuine anomaly worth a breadcrumb — then treated as
 * carrying no id (never fails the whole binding scan).
 */
function parseCustomToolResult(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? z.record(z.string(), z.unknown()).parse(parsed)
      : null;
  } catch (cause) {
    captureException(cause, { feature: 'tooling', op: 'browse-replay-bind-parse' });
    return null;
  }
}

async function browserbaseGet(path: string, browserbaseSessionId: string): Promise<Response> {
  try {
    return await fetch(`${BROWSERBASE_API_BASE}${path}`, {
      headers: { 'X-BB-API-Key': browserbaseCapability().apiKey },
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not reach Browserbase for the session replay',
      { browserbaseSessionId },
      { cause },
    );
  }
}

/**
 * Replay metadata for a Browserbase session (its recorded tabs + page ids).
 * Returns `{ pages: [] }` when Browserbase has no recording (404) — the card
 * reads empty pages as "no replay available", never an error. Any other upstream
 * failure throws EXTERNAL_API_FAILED (→503).
 */
export async function loadReplayMetadata(input: {
  browserbaseSessionId: string;
}): Promise<ReplayMetadata> {
  const { browserbaseSessionId } = input;
  const res = await browserbaseGet(
    `/sessions/${encodeURIComponent(browserbaseSessionId)}/replays`,
    browserbaseSessionId,
  );
  // No recording for this session (too old / never captured) is a normal answer.
  if (res.status === 404) return { pages: [] };
  if (!res.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Could not load the session replay', {
      status: res.status,
      browserbaseSessionId,
    });
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Session replay response was not valid JSON',
      { browserbaseSessionId },
      { cause },
    );
  }
  const metadata = parseReplayMetadata(json);
  if (!metadata) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Browserbase returned an unexpected replay shape',
      {
        browserbaseSessionId,
      },
    );
  }
  return metadata;
}

/**
 * The raw HLS `.m3u8` manifest text for one recorded tab. Its segment lines are
 * absolute, pre-signed CDN URLs (valid ~6h) that the player fetches directly —
 * only this manifest request carries our key. Throws EXTERNAL_API_FAILED (→503)
 * when the manifest is missing or the fetch fails; the client's player then
 * shows its plain "couldn't play" line.
 */
export async function loadReplayManifest(input: {
  browserbaseSessionId: string;
  pageId: string;
}): Promise<string> {
  const { browserbaseSessionId, pageId } = input;
  const res = await browserbaseGet(
    `/sessions/${encodeURIComponent(browserbaseSessionId)}/replays/${encodeURIComponent(pageId)}`,
    browserbaseSessionId,
  );
  if (!res.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Could not load the session replay', {
      status: res.status,
      browserbaseSessionId,
      pageId,
    });
  }
  try {
    return await res.text();
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not read the session replay',
      { browserbaseSessionId, pageId },
      { cause },
    );
  }
}
