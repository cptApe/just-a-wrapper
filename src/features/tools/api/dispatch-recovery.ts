import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { customToolDispatch } from '@/db/schema';
import type { DispatchContext, DispatchOutcome, ToolCall } from '@/features/tool-catalog/types';
import { captureException } from '@/lib/observability';
import { recoverStoredToolDelivery } from './tool-delivery';
import { expireToolDecisions } from './tool-delivery-transitions';

export type RecoveredDispatch = {
  outcomes: DispatchOutcome[];
  retryCalls: ToolCall[];
};

// A call still awaiting a decision stays pending; every other claim recovers its stored delivery.
// A call whose claim row this session cannot see lost a race it cannot recover, so it retries.
export async function recoverClaimedCustomToolCalls(
  calls: ToolCall[],
  ctx: DispatchContext,
): Promise<RecoveredDispatch> {
  await expireToolDecisions(ctx.sessionRowId);
  const claims = await db
    .select()
    .from(customToolDispatch)
    .where(
      and(
        eq(customToolDispatch.sessionId, ctx.sessionRowId),
        inArray(
          customToolDispatch.toolUseId,
          calls.map((call) => call.toolUseId),
        ),
      ),
    );
  const claimsById = new Map(claims.map((claim) => [claim.toolUseId, claim]));
  const outcomes: DispatchOutcome[] = [];
  const retryCalls: ToolCall[] = [];

  for (const call of calls) {
    const claim = claimsById.get(call.toolUseId);
    if (!claim) {
      retryCalls.push(call);
      continue;
    }
    try {
      outcomes.push(await recoverStoredToolDelivery(ctx, claim));
    } catch (error) {
      captureException(error, {
        feature: 'tooling',
        op: 'recover-delivery',
        toolUseId: call.toolUseId,
      });
      outcomes.push({
        toolUseId: call.toolUseId,
        name: call.name,
        status: 'retry',
        detail: 'DELIVERY_PENDING',
      });
    }
  }

  return { outcomes, retryCalls };
}
