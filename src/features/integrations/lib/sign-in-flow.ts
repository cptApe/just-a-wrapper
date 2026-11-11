import type { IntegrationView, TesterNotice } from '../types';

export const TIMED_POLLS = 5;
const POLL_INTERVAL_MS = 3000;

export type ConnectionPhase = 'idle' | 'connecting' | 'disconnecting' | 'checking' | 'awaiting';

/** One phase at a time; a person's action outranks the background wait for sign-in. */
export function connectionPhase(pending: {
  connecting: boolean;
  disconnecting: boolean;
  checking: boolean;
  awaiting: boolean;
}): ConnectionPhase {
  if (pending.connecting) return 'connecting';
  if (pending.disconnecting) return 'disconnecting';
  if (pending.checking) return 'checking';
  if (pending.awaiting) return 'awaiting';
  return 'idle';
}

/** Resolves on the next poll: after the delay, when the person returns to this tab, or on abort. */
function nextPoll(target: EventTarget, signal: AbortSignal, delay: number | null): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener('focus', done);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = delay === null ? undefined : setTimeout(done, delay);
    target.addEventListener('focus', done, { once: true });
    signal.addEventListener('abort', done, { once: true });
  });
}

// A function call, so the check after an await is not narrowed away by the one before it.
const aborted = (signal: AbortSignal) => signal.aborted;

type StatusRead = { view: IntegrationView; notice: null } | { view: null; notice: TesterNotice };

// The sign-in tab can take any amount of time. Timed polls stop after their budget; returning to
// this tab keeps checking until the sign-in is done, a check fails, or the wait is aborted.
export async function waitForSignIn({
  polls,
  signal,
  read,
  isDone,
  focusTarget = window,
}: {
  polls: number;
  signal: AbortSignal;
  read: () => Promise<StatusRead>;
  isDone: (view: IntegrationView) => boolean;
  focusTarget?: EventTarget;
}): Promise<{ notice: TesterNotice | null; aborted: boolean }> {
  let left = polls;
  for (;;) {
    await nextPoll(focusTarget, signal, left > 0 ? POLL_INTERVAL_MS : null);
    if (aborted(signal)) return { notice: null, aborted: true };
    left = Math.max(left - 1, 0);
    const { view, notice } = await read();
    if (aborted(signal)) return { notice: null, aborted: true };
    if (notice !== null) return { notice, aborted: false };
    if (isDone(view)) return { notice: null, aborted: false };
  }
}
