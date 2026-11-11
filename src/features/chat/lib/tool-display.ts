import { classifyToolAccess } from '@/features/permissions/lib/classify';
import { extractEmbeddedToolSlugs } from '@/features/permissions/lib/resolve';
import { formatDuration } from '@/lib/format/format-duration';
import { plural } from '@/lib/format/plural';
import { toolkitSlugOf } from './tool-display-activity';

// The audience is non-technical: tool activity reads as plain language,
// not technical detail. Every call resolves to one of four presentation tiers, and
// consecutive quiet calls fold into a single collapsed chain. This
// module is the pure, single copy source for both the tier of a call whose
// descriptor doesn't name one (connected-app actions, resolved from the same
// read/write classification the gate uses) and every string the chain shows.

/**
 * How prominently a tool call renders in the thread. Four tiers:
 *   • hidden  — never standalone; a tiny bodyless row only inside a chain.
 *   • whisper — one soft borderless line; raw result content never shows.
 *   • process — the normal compact card, groupable into a chain.
 *   • product — rich, standalone, never grouped (media, leads, gates).
 * The registry descriptor names a tier per tool; anything without one resolves
 * dynamically here.
 */
export type ToolVisibility = 'hidden' | 'whisper' | 'process' | 'product';

/**
 * The tier for a call whose descriptor doesn't name one. Connected-app actions
 * (direct slugs or the batch executor's embedded slugs) split on the SAME
 * read/write classification the gate resolves on: a write is an action receipt
 * (product), a read is a quiet process step. A single write inside a batch makes
 * the whole call a product. Everything else defaults to process.
 */
export function resolveDynamicVisibility(
  name: string,
  input: Record<string, unknown>,
): ToolVisibility {
  const embedded = extractEmbeddedToolSlugs(name, input);
  if (embedded.length > 0) {
    return embedded.some((slug) => classifyToolAccess(slug) === 'write') ? 'product' : 'process';
  }
  // Presentation depends on the allowlist: an unlisted toolkit silently falls back to process.
  if (toolkitSlugOf(name, input) !== undefined) {
    return classifyToolAccess(name) === 'write' ? 'product' : 'process';
  }
  return 'process';
}

/** One step in a settled chain, projected to what the summary needs. */
export type ChainStep =
  | { kind: 'thought'; at?: string }
  | { kind: 'tool'; failed: boolean; at?: string; settledAt?: string };

export type ChainSummary = {
  /** Every step in the chain — the accurate total, thinking and hidden included. */
  total: number;
  /** How many tool steps errored. Never shown as a badge: a failed call is the
   *  agent trying something, and the row's own phrase already says so. */
  failed: number;
  /** The wall-clock span the chain covers: earliest step timestamp to the
   *  latest settle. Absent when the steps carry too little timing data to
   *  measure accurately — the lead line then falls back to the step count. */
  durationMs?: number;
};

/**
 * Summarize a settled chain: the accurate step total, the failed count, and the
 * wall-clock span the timestamps prove — earliest step `at` to the latest of
 * any `at`/`settledAt`. A tool without a result timestamp still bounds the
 * span by its start, so the span can undercount a trailing untimed call but
 * never inflates. Fewer than two distinct instants (old history without
 * timestamps) leaves `durationMs` unset.
 */
export function summarizeChainSteps(steps: ChainStep[]): ChainSummary {
  let failed = 0;
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const step of steps) {
    const at = step.at === undefined ? Number.NaN : Date.parse(step.at);
    if (Number.isFinite(at)) {
      if (at < startMs) startMs = at;
      if (at > endMs) endMs = at;
    }
    if (step.kind !== 'tool') continue;
    const settledAt = step.settledAt === undefined ? Number.NaN : Date.parse(step.settledAt);
    if (Number.isFinite(settledAt) && settledAt > endMs) endMs = settledAt;
    if (step.failed) failed += 1;
  }
  return {
    total: steps.length,
    failed,
    ...(endMs > startMs ? { durationMs: endMs - startMs } : {}),
  };
}

/** "42 seconds" under a minute, "3 minutes" from there — rounded, never zero. */
/**
 * The settled chain's lead line: "Worked for 42 seconds" — time only, chosen
 * on purpose. What happened shows on expand. Without a
 * measured duration (old history items carry no timestamps) it falls back to
 * the accurate step count: "Worked through N steps".
 */
export function chainLeadLine(summary: ChainSummary): string {
  if (summary.durationMs === undefined) {
    return `Worked through ${plural(summary.total, 'step')}`;
  }
  return `Worked for ${formatDuration(summary.durationMs)}`;
}

// Copy for the "Watch replay" affordance on the browse_page snapshot. Plain
// sentences, no jargon, no em dashes — the single copy source so the component holds none.

/** Accessible label + chip text for the play affordance over the snapshot. */
export const REPLAY_WATCH_LABEL = 'Watch replay';

/** The text button that returns the player to the still snapshot. */
export const REPLAY_BACK_LABEL = 'Back to snapshot';
