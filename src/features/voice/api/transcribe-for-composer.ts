import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import 'server-only';
import { accrueVoiceTranscription } from '@/features/billing/api/accrue-voice';
import { resolveMediaCost } from '@/features/billing/api/resolve-media-cost';
import { assertCanSpend } from '@/features/billing/api/spend-gate';
import { creditsForVendorCents } from '@/features/billing/lib/credit-math';
import { transcriptionEstimateCents } from '@/features/billing/pricing-config';
import { capabilities } from '@/lib/runtime-capabilities';
import { STT_MODEL_ID, transcriptionUpperBoundSeconds } from '../lib/voice-contract';
import { transcribeAudio } from './transcribe-audio';

export async function transcribeForComposer(input: {
  workspaceId: string;
  organizationId: string;
  userId: string;
  audio: File;
}) {
  try {
    const { workspaceId, organizationId, userId, audio } = input;
    // The browser's stated duration is not trusted; the file size bounds what the vendor can bill.
    await assertCanSpend({
      entry: 'dictation',
      workspaceId,
      userId,
      credits: creditsForVendorCents(
        transcriptionEstimateCents(transcriptionUpperBoundSeconds(audio.size)),
      ),
    });
    const { text, audioSeconds, generationId } = await transcribeAudio(capabilities.media, {
      file: audio,
    });
    const vendorCostCents = await resolveMediaCost(capabilities.media, {
      generationId,
      model: STT_MODEL_ID,
      estimatedCostCents: transcriptionEstimateCents(audioSeconds),
    });
    await accrueVoiceTranscription({
      workspaceId,
      organizationId,
      userId,
      audioSeconds,
      requestId: randomUUID(),
      vendorCostCents,
    });

    return { text };
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
