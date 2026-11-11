import { db } from '@/db';
import 'server-only';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordSessionUsage } from './record-session-usage';

// Each delivered play has its own namespaced request ID for deferred billing. The listener pays.
export async function accrueVoiceSynthesis(input: {
  anthropicSessionId: string;
  requestId: string;
  userId: string;
  vendorCostCents: number;
}): Promise<AccrualResult> {
  const usageKey = `tts:${input.requestId}`;
  return accrue(
    { anthropicSessionId: input.anthropicSessionId, kind: 'voice_tts' },
    usageKey,
    (target) =>
      db.transaction((tx) =>
        recordSessionUsage(
          tx,
          target,
          { vendorCostCents: input.vendorCostCents, eventType: 'voice_tts', eventId: usageKey },
          input.userId,
        ),
      ),
  );
}
