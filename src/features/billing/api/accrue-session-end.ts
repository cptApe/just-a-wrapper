import { db } from '@/db';
import 'server-only';
import { requireAnthropicClient } from '@/features/agents/api/anthropic-client';
import { containerRuntimeCents } from '../lib/credit-math';
import { roundVendorCents } from '../lib/round-vendor-cents';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordSessionUsage } from './record-session-usage';
import { lockSessionTotals } from './record-usage';

// Idle happens after every turn. Reconcile cumulative runtime under the session lock because relay and webhook IDs differ.
// `container_seconds` is the high-water mark; the new seconds' exact cost joins the session total.
// Do not write endedAt here: billing an idle turn does not terminate the session.
export async function accrueSessionEnd(
  anthropicSessionId: string,
  options: {
    anthropicEventId: string;
    runtime: { kind: 'fetch' } | { kind: 'snapshot'; activeSeconds: number };
  },
): Promise<AccrualResult> {
  return accrue(
    { anthropicSessionId, kind: 'container_runtime' },
    options.anthropicEventId,
    async (target) => {
      const totalSeconds = Math.max(
        0,
        Math.floor(
          options.runtime.kind === 'snapshot'
            ? options.runtime.activeSeconds
            : await fetchActiveSecondsFromAnthropic(anthropicSessionId),
        ),
      );
      return db.transaction(async (tx) => {
        const locked = await lockSessionTotals(tx, target.rowId);
        if (!locked) return null;
        const deltaSeconds = totalSeconds - locked.containerSeconds;
        if (deltaSeconds <= 0) return null; // already reconciled by the other path

        // Difference of the rounded cumulative costs, so many small idles add up to the exact total.
        const vendorCostCents = roundVendorCents(
          Math.max(
            0,
            roundVendorCents(containerRuntimeCents(totalSeconds)) -
              roundVendorCents(containerRuntimeCents(locked.containerSeconds)),
          ),
        );
        return recordSessionUsage(tx, target, {
          vendorCostCents,
          eventType: 'container_runtime',
          eventId: options.anthropicEventId,
          seconds: deltaSeconds,
        });
      });
    },
  );
}

async function fetchActiveSecondsFromAnthropic(anthropicSessionId: string): Promise<number> {
  const client = requireAnthropicClient();
  const session = await client.beta.sessions.retrieve(anthropicSessionId, undefined, {
    timeout: 30_000,
  });
  // usage counts overlapping threads once; stats sums their durations and would double-charge runtime.
  // The provider omits active_seconds for a session that never ran.
  return session.usage.active_seconds ?? 0;
}
