import { db } from '@/db';
import { captureEvent } from '@/lib/analytics';
import { capabilities } from '@/lib/runtime-capabilities';
import 'server-only';
import { type AccrualResult } from './accrual-result';
import { accrue } from './accrue';
import { recordWorkspaceUsage, type WorkspacePayer } from './record-workspace-usage';

// Dictation has no session, so it rounds once per request.
export async function accrueVoiceTranscription(input: {
  workspaceId: string;
  organizationId: string;
  userId: string;
  requestId: string;
  audioSeconds: number;
  vendorCostCents: number;
}): Promise<AccrualResult> {
  const payer: WorkspacePayer = {
    workspaceId: input.workspaceId,
    organizationId: input.organizationId,
    userId: input.userId,
    platformPaid: capabilities.billing.kind === 'off',
  };
  const usageKey = `voice:${input.requestId}`;
  return accrue(payer, usageKey, async (target) => {
    const applied = await db.transaction((tx) =>
      recordWorkspaceUsage(tx, target, {
        eventType: 'voice_transcription',
        eventId: usageKey,
        vendorCostCents: input.vendorCostCents,
        audioSeconds: input.audioSeconds,
      }),
    );
    // Dictation has no turn, so it reports its own spend; turns report theirs from the relay.
    if (applied?.charge && !applied.charge.platformCost)
      captureEvent(
        'billing:credit_spend',
        {
          credits: applied.credits,
          balance_after: applied.charge.balance,
          usage_kind: 'voice_transcription',
          tier: null,
        },
        { userId: input.userId, workspaceId: input.workspaceId },
      );
    return applied;
  });
}
