import type { CSSProperties } from 'react';

type TimedStyle = CSSProperties & { '--landing-delay': string; '--landing-hold'?: string };

// One timeline for the hero's task, shared by the thread and the sidebar spinner.
const SENT_AT_MS = 900;
const FIRST_STEP_AT_MS = SENT_AT_MS + 500;
const STEP_MS = 950;
const STEP_OVERLAP_MS = 150;
const STEP_COUNT = 3;
const SETTLED_AT_MS = FIRST_STEP_AT_MS + STEP_MS * STEP_COUNT;

export const SENT: TimedStyle = { '--landing-delay': `${SENT_AT_MS}ms` };

/** The sidebar spinner runs from the send to the answer. */
export const TASK_RUN: TimedStyle = {
  '--landing-delay': `${SENT_AT_MS}ms`,
  '--landing-hold': `${SETTLED_AT_MS - SENT_AT_MS}ms`,
};

/** Each live step overlaps the next so the line crossfades in place. */
export function stepTiming(index: number): TimedStyle {
  return {
    '--landing-delay': `${FIRST_STEP_AT_MS + STEP_MS * index}ms`,
    '--landing-hold': `${STEP_MS + STEP_OVERLAP_MS}ms`,
  };
}

/** What lands after the work: the settled line, the reply, the file, the actions. */
export function settledTiming(beat: number): TimedStyle {
  return { '--landing-delay': `${SETTLED_AT_MS + 200 * beat}ms` };
}
