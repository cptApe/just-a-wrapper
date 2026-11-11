import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { z } from 'zod';

// Pure browser-replay shaping uses relative imports for Node tests.
// The server proxy authenticates replay and manifest requests; clients address tabs by pageId.
// HLS segments use presigned CDN URLs and need no proxy. Refresh expired
// manifests to obtain fresh segment URLs.

/** Browserbase REST base. The replay endpoints hang off `/sessions/{id}`. */
export const BROWSERBASE_API_BASE = 'https://api.browserbase.com/v1';

/** One recorded tab in a session's replay. `pageId` is the manifest key. */
type ReplayPage = {
  pageId: string;
  /** Milliseconds from session start; present when the metadata carried them. */
  startTimeMs?: number;
  endTimeMs?: number;
};

/** The card-facing replay metadata: the recorded tabs, oldest first. An empty
 *  `pages` means no replay exists for the session (too old / never recorded). */
export type ReplayMetadata = { pages: ReplayPage[] };

const replayPageSchema = z.object({
  // Docs show a string pageId ("0"); accept a number too and normalize, so a
  // shape drift to numeric ids doesn't drop the whole replay.
  pageId: z.union([z.string(), z.number()]).transform(String),
  startTimeMs: z.number().optional(),
  endTimeMs: z.number().optional(),
});

const replayMetadataSchema = z.object({ pages: z.array(replayPageSchema) });

/**
 * Shape Browserbase's replay-metadata JSON into the minimal record the card
 * needs. Returns null when the payload is off-contract — the caller treats that
 * as an upstream fault; an *empty* `pages` list is a valid "no replay" answer.
 */
export function parseReplayMetadata(raw: unknown): ReplayMetadata | null {
  const parsed = replayMetadataSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    pages: parsed.data.pages.map((p) => ({
      pageId: p.pageId,
      ...(p.startTimeMs !== undefined ? { startTimeMs: p.startTimeMs } : {}),
      ...(p.endTimeMs !== undefined ? { endTimeMs: p.endTimeMs } : {}),
    })),
  };
}

// The custom tools that create a Browserbase recording. Duplicated (not
// imported) so this module stays free of the `@/` alias and remains importable
// under the node --test type-stripping runner.
const RECORDING_BROWSER_TOOL_NAMES = new Set(['browse_page', 'browse_open']);

/**
 * The Browserbase session ids this session actually recorded — one per
 * browser-opening result in its own event history. This is the server-side proof
 * that a `?bb=<id>` replay request names a session THIS chat produced (the
 * ownership tie for the replay routes): a Browserbase id is honored only when
 * it appears here, so a member can't pair their owned session with a foreign
 * Browserbase id to replay someone else's browsing.
 *
 * Correlation is by tool-use id, not just the field name: an id is trusted only
 * when it rode back on the result of a recording browser call (a future custom tool
 * that happened to echo `browserbaseSessionId` can't widen the set). `parseResult`
 * turns a custom-tool-result text block into its object — JSON.parse on the
 * server, a fixture reader in tests — so this stays pure and node-testable while
 * the caller owns error capture on a malformed block.
 */
export function recordedBrowserbaseSessionIds(
  events: ReadonlyArray<BetaManagedAgentsSessionEvent>,
  parseResult: (text: string) => Record<string, unknown> | null,
): Set<string> {
  const browseUseIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'agent.custom_tool_use' && RECORDING_BROWSER_TOOL_NAMES.has(event.name)) {
      browseUseIds.add(event.id);
    }
  }

  const recorded = new Set<string>();
  for (const event of events) {
    if (event.type !== 'user.custom_tool_result') continue;
    if (!browseUseIds.has(event.custom_tool_use_id)) continue;
    for (const block of event.content ?? []) {
      if (block.type !== 'text') continue;
      const bb = parseResult(block.text)?.browserbaseSessionId;
      if (typeof bb === 'string' && bb) recorded.add(bb);
    }
  }
  return recorded;
}
