import { createParser, parseAsStringLiteral } from 'nuqs/server';
import { z } from 'zod';
import { usageParsers } from '@/features/billing/lib/usage-search-params';

// Page-local extension of the shared usage query schema (usage-search-params.ts
// stays the cross-feature contract; these two keys exist only for this page).
// One object imported by both the server loader and the client island, same
// no-drift rule as the base schema.
//   ?view    log | task | member — the active Activity tab. Shallow: the server
//            always loads all three views' data, so switching is instant.
//   ?events  how many log rows the window currently shows. Non-shallow: Load
//            more widens the server read. The Boundary key excludes it, so a
//            widen streams in without dropping the page to its skeleton.

/** First page of the log. */
const LOG_INITIAL_EVENTS = 50;
/** Each Load more widens the window by this many rows. */
export const LOG_STEP_EVENTS = 100;
// Hard ceiling on the windowed list: past this the DOM (and the widen-reread)
// stops being "smooth", so the UI says to narrow the period instead.
export const LOG_MAX_EVENTS = 2000;

export const usagePageParsers = {
  ...usageParsers,
  view: parseAsStringLiteral(['log', 'task', 'member'] as const).withDefault('log'),
  events: createParser({ parse: (value) => clampEventsLimit(Number(value)), serialize: String })
    .withDefault(LOG_INITIAL_EVENTS)
    .withOptions({ shallow: false }),
};

/** Server-side guard: a hand-edited ?events is clamped, never trusted. */
export function clampEventsLimit(value: number): number {
  if (!Number.isFinite(value)) return LOG_INITIAL_EVENTS;
  return Math.min(Math.max(Math.trunc(value), LOG_INITIAL_EVENTS), LOG_MAX_EVENTS);
}

export function normalizeUsageParams<
  T extends {
    period: 'cycle' | 'last' | 'custom';
    from: string | null;
    to: string | null;
    events: number;
  },
>(params: T): T {
  const valid =
    params.from !== null &&
    params.to !== null &&
    z.iso.date().safeParse(params.from).success &&
    z.iso.date().safeParse(params.to).success &&
    params.from <= params.to;
  const period = params.period === 'custom' && !valid ? 'cycle' : params.period;
  return {
    ...params,
    period,
    from: period === 'custom' ? params.from : null,
    to: period === 'custom' ? params.to : null,
  };
}

export function normalizeUsageView(view: 'log' | 'task' | 'member', isAdmin: boolean) {
  return view === 'member' && !isAdmin ? 'task' : view;
}
