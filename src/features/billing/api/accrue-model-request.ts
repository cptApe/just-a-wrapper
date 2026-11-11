import { db } from '@/db';
import 'server-only';
import { type ModelTokenUsage, modelRequestCents } from '../lib/credit-math';
import { roundVendorCents } from '../lib/round-vendor-cents';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordModelObservation } from './record-model-observation';
import { recordSessionUsage } from './record-session-usage';
import { lockSessionTotals } from './record-usage';

// Every span is recorded with its exact cost, even when that adds no whole credit.
export async function accrueModelRequest(input: {
  anthropicSessionId: string;
  anthropicEventId: string;
  usage: ModelTokenUsage;
}): Promise<AccrualResult> {
  return accrue(
    { anthropicSessionId: input.anthropicSessionId, kind: 'model_request' },
    input.anthropicEventId,
    (target) =>
      db.transaction(async (tx) => {
        if (!(await lockSessionTotals(tx, target.rowId))) return null;
        const uncovered = await recordModelObservation(tx, {
          sessionId: target.rowId,
          eventId: input.anthropicEventId,
          ...input.usage,
          vendorCostCents: roundVendorCents(modelRequestCents(target.tier, input.usage)),
        });
        if (!uncovered) return null;
        return recordSessionUsage(tx, target, {
          eventType: 'model_request',
          eventId: input.anthropicEventId,
          ...uncovered,
        });
      }),
  );
}
