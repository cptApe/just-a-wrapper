import { defineStateMachine } from '@/lib/state-machine';

// A browser_candidate row exists from before the provider create until the browser is owned by
// the session row or released and billed; both endings delete the row.
export type BrowserCandidateState = 'creating' | 'created';
export const browserCandidateMachine = defineStateMachine<BrowserCandidateState>(
  'browser candidate',
  {
    creating: ['created'],
    created: [],
  },
);

/** The metadata key a candidate's provider session carries, so the sweep can find it by id. */
export const BROWSER_CANDIDATE_TAG = 'browserCandidateId';

/** Longer than any route may run, so a candidate this old belongs to a process that is gone. */
export const BROWSER_CANDIDATE_LEASE_MS = 600_000;
