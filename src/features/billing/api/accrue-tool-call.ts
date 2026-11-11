import { db } from '@/db';
import 'server-only';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordSessionUsage } from './record-session-usage';

// A tool-prefixed usage key keeps retries idempotent without colliding with lifecycle events.
export async function accrueToolCall(input: {
  anthropicSessionId: string;
  toolUseId: string;
  toolName: string;
  vendorCostCents: number;
  source: 'tool_call' | 'generation';
}): Promise<AccrualResult> {
  const usageKey = `tool:${input.toolUseId}`;
  return accrue(
    { anthropicSessionId: input.anthropicSessionId, kind: input.source },
    usageKey,
    (target) =>
      db.transaction((tx) =>
        recordSessionUsage(tx, target, {
          vendorCostCents: input.vendorCostCents,
          eventType: input.source,
          eventId: usageKey,
        }),
      ),
  );
}
