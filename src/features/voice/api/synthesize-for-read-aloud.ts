import { AppError } from '@/lib/errors';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { accrueVoiceSynthesis } from '@/features/billing/api/accrue-voice-synthesis';
import { resolveMediaCost } from '@/features/billing/api/resolve-media-cost';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { speechEstimateCents } from '@/features/billing/pricing-config';
import { capabilities } from '@/lib/runtime-capabilities';
import { DEFAULT_VOICE_ID, TTS_MODEL_ID } from '../lib/voice-contract';
import { synthesizeSpeech } from './synthesize-speech';

export async function synthesizeForReadAloud(input: {
  anthropicSessionId: string;
  workspaceId: string;
  userId: string;
  text: string;
}) {
  try {
    const { anthropicSessionId, workspaceId, text } = input;
    const estimatedCostCents = speechEstimateCents(text.length);
    // Read-aloud is charged to the listener, so their member limit is the one checked.
    await assertCanSpend({
      entry: 'read_aloud',
      workspaceId,
      userId: input.userId,
      credits: creditsForVendorCents(estimatedCostCents),
    });
    const speech = await synthesizeSpeech(capabilities.media, {
      text,
      voiceId: DEFAULT_VOICE_ID,
    });
    const requestId = randomUUID();
    const vendorCostCents = await resolveMediaCost(capabilities.media, {
      generationId: speech.generationId,
      model: TTS_MODEL_ID,
      estimatedCostCents,
    });
    await accrueVoiceSynthesis({
      anthropicSessionId,
      requestId,
      vendorCostCents,
      userId: input.userId,
    });

    return speech;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Voice request failed',
      { workspaceId: input.workspaceId },
      { cause },
    );
  }
}
