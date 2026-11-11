import 'server-only';
import type { BetaManagedAgentsSessionEvent } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { shipLog } from '@/lib/logger';
import { accrueModelRequest } from './accrue-model-request';
import { accrueUsageReconciliation } from './accrue-usage-reconciliation';

export type UsageEvent = Extract<
  BetaManagedAgentsSessionEvent,
  { type: 'span.model_request_end' | 'session.usage' }
>;

export async function accrueSessionUsageEvent(sessionId: string, event: UsageEvent): Promise<void> {
  if (event.type === 'span.model_request_end') {
    const usage = event.model_usage;
    await accrueModelRequest({
      anthropicSessionId: sessionId,
      anthropicEventId: event.id,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens,
        cacheReadTokens: usage.cache_read_input_tokens,
      },
    });
    return;
  }
  const cost = event.usage.list_cost;
  const amount = cost ? Number(cost.amount) : null;
  // Widen the SDK enum because the provider can introduce currencies before the SDK updates.
  const currency: string | undefined = cost?.currency;
  if (
    cost &&
    (currency !== 'USD' || !/^(?:0|[1-9]\d*)$/.test(cost.amount) || !Number.isSafeInteger(amount))
  ) {
    shipLog({
      level: 'warn',
      msg: 'billing.unsupported_list_cost',
      feature: 'billing',
      op: 'accrue-session-usage',
      sessionId,
      eventId: event.id,
      amount: cost.amount,
      currency,
    });
    return;
  }
  const cache = event.usage.cache_creation;
  await accrueUsageReconciliation({
    anthropicSessionId: sessionId,
    anthropicEventId: event.id,
    snapshot: {
      inputTokens: event.usage.input_tokens ?? 0,
      outputTokens: event.usage.output_tokens ?? 0,
      cacheCreationTokens:
        (cache?.ephemeral_1h_input_tokens ?? 0) + (cache?.ephemeral_5m_input_tokens ?? 0),
      cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
    },
    listCostMinorUnits: amount,
    activeSeconds: event.usage.active_seconds ?? 0,
  });
}
