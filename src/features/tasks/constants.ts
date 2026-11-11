// Offer only triggers with a working live integration.
// GMAIL_NEW_GMAIL_MESSAGE supports interval, labelIds, query and userId config.
export const EVENT_TRIGGER_CATALOG = [
  {
    toolkit: 'gmail',
    eventType: 'GMAIL_NEW_GMAIL_MESSAGE',
    label: 'Gmail: new email arrives',
  },
] as const;

// User-facing cap: one initial run plus at most two revisions. The SDK's
// max_iterations counts 0-indexed evaluation/revision cycles (default 3, max 20).
export const MAX_TASK_REVIEW_ITERATIONS = 2;

// Live runs one event task may have at once; a delivery past it is recorded as skipped (F071).
export const EVENT_TASK_MAX_LIVE_RUNS = 3;

export const TASK_TIERS = ['fast', 'default', 'pro'] as const;

// Window caps for the /scheduled queries — the surface is a recency view, not
// an archive. Calendar months older than the capped history window render empty.
export const ATTENTION_LIMIT = 50;
export const UPCOMING_LIMIT = 100;
export const FINISHED_SCHEDULE_LIMIT = 10;
export const HISTORY_LIMIT = 200;
