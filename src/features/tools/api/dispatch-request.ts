import { assertPendingAnthropicCustomToolCalls } from '@/features/sessions/api/anthropic-events';
import type { DispatchContext, DispatchOutcome, ToolCall } from '@/features/tool-catalog/types';
import { dispatchBatch, prepareCustomToolDispatchGates } from '@/features/tools/api/dispatch';
import { resolveDispatchContext } from '@/features/tools/api/dispatch-context';
import { recoverClaimedCustomToolCalls } from '@/features/tools/api/dispatch-recovery';
import { claimAnthropicCustomToolCalls } from '@/features/tools/api/tool-delivery-transitions';

export async function dispatchRequest(
  input: { sessionId: string; calls: Array<Pick<ToolCall, 'toolUseId' | 'name'>> },
  requestHeaders: Headers,
) {
  const ctx = await resolveDispatchContext(requestHeaders, input.sessionId);
  return dispatchSessionToolCalls(input.calls, ctx, 'reject');
}

export async function dispatchSessionToolCalls(
  requested: Array<Pick<ToolCall, 'toolUseId' | 'name'>>,
  ctx: DispatchContext,
  resolved: 'reject' | 'skip',
) {
  const { inputs, resolvedIds } = await assertPendingAnthropicCustomToolCalls(
    ctx.anthropicSessionId,
    requested,
    resolved,
  );
  const calls = requested
    .filter((call) => !resolvedIds.has(call.toolUseId))
    .map((call) => ({ ...call, input: inputs.get(call.toolUseId) }));
  if (calls.length === 0) return [];
  const { parkedCalls, gates } = await prepareCustomToolDispatchGates(calls, ctx);
  const { claimed, unclaimed } = await claimAnthropicCustomToolCalls(
    ctx.sessionRowId,
    calls,
    parkedCalls,
  );
  const recoveredOutcomes = unclaimed.length > 0 ? await recoverUnclaimed(unclaimed, ctx) : [];
  const dispatchedOutcomes = await dispatchBatch(claimed, ctx, gates);
  const outcomesById = new Map(
    [...recoveredOutcomes, ...dispatchedOutcomes].map((outcome) => [outcome.toolUseId, outcome]),
  );
  const outcomes = calls.flatMap((call) => {
    const outcome = outcomesById.get(call.toolUseId);
    return outcome ? [outcome] : [];
  });
  return outcomes;
}

// Another request owns these claims. A call whose claim row this session cannot see lost the race
// to a claim it cannot recover, so the client retries it later.
async function recoverUnclaimed(calls: ToolCall[], ctx: DispatchContext) {
  const recovered = await recoverClaimedCustomToolCalls(calls, ctx);
  return [
    ...recovered.outcomes,
    ...recovered.retryCalls.map(
      (call): DispatchOutcome => ({
        toolUseId: call.toolUseId,
        name: call.name,
        status: 'retry',
        detail: 'CLAIM_RACE',
      }),
    ),
  ];
}
