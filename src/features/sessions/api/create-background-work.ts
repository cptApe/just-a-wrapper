import { type BackgroundWorkState, reduceBackgroundWork } from '../lib/background-work-machine';
import 'server-only';
import { after } from 'next/server';
import { captureException } from '@/lib/observability';
import { type RequestContext, snapshotCtx, withRequestContext } from '@/lib/request-context';

// Background work retains request attribution and drains after stream closure without blocking
// SSE. Billing order is per connection; event IDs protect cross-tab replay.

export type RelayBackgroundWork = {
  run(op: string, fn: () => unknown): void;

  /** Signal that the stream has closed. A run() racing close() (the generator's
   * finally vs a late event) is still executed and awaited — billing work is
   * never dropped; it just extends settled() by that task's duration. */
  close(): void;

  /** Resolves after close() once every scheduled task has settled. */
  settled(): Promise<void>;
};

const ORDERED_BACKGROUND_OPS = new Set([
  'sync-status',
  'accrue-model-request',
  'accrue-usage-reconciliation',
  'reconcile-session-search-text',
  // Turn analytics must follow billing so their spend query includes the accrued usage rows.
  'analytics-turn-complete',
]);

export function createBackgroundWork(
  snapshot: RequestContext,
  sessionId: string,
): RelayBackgroundWork {
  let state: BackgroundWorkState = { phase: 'open' };
  const pending = new Set<Promise<unknown>>();
  let orderedChain = Promise.resolve();
  const { promise: closed, resolve: release } = Promise.withResolvers<void>();
  return {
    run(op, fn) {
      state = reduceBackgroundWork(state, 'enqueue');
      // Background tasks report at this boundary; one failed task must not cancel billing that follows.
      const execute = () =>
        withRequestContext(snapshot, async () => {
          await fn();
        }).catch((error) => captureException(error, { sessionId, op }));
      // Order billing, search persistence and analytics per connection. Event IDs and monotone
      // billing/search guards make concurrent relays safe.
      const ordered = ORDERED_BACKGROUND_OPS.has(op);
      const operation = ordered ? orderedChain.then(execute) : execute();
      if (ordered)
        orderedChain = operation.then(
          () => undefined,
          () => undefined,
        );
      const task = operation.then(
        () => {
          pending.delete(task);
        },
        () => {
          pending.delete(task);
        },
      );
      pending.add(task);
    },
    close: () => {
      state = reduceBackgroundWork(state, 'close');
      release();
    },
    async settled() {
      await closed;
      // Tasks are individually caught above, so allSettled never rejects; loop
      // in case a settling task's continuation was still being added.
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
      state = reduceBackgroundWork(state, 'drain');
    },
  };
}

// Single post-response jobs retain attribution and report failures once at this boundary.
export function runAfterResponse(
  op: string,
  context: Record<string, unknown>,
  fn: () => Promise<void>,
): void {
  const snapshot = snapshotCtx();
  after(() =>
    withRequestContext(snapshot, async () => {
      try {
        await fn();
      } catch (error) {
        captureException(error, { ...context, op });
      }
    }),
  );
}
