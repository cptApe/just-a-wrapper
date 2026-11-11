import 'server-only';
import { createGateway } from 'ai';
import { z } from 'zod';
import type { MediaCapability } from './capabilities';
import { CAPABILITY_OFF_MESSAGES } from './capability-messages';
import { CapabilityOffError, IntegrationError } from './errors';
import { retryWhile } from './retry-while';

export function mediaGateway(capability: MediaCapability) {
  if (capability.kind === 'off') {
    throw new CapabilityOffError(CAPABILITY_OFF_MESSAGES.media, { capability: 'media' });
  }
  return createGateway({ apiKey: capability.apiKey });
}

const generationSchema = z.object({ gateway: z.object({ generationId: z.string().min(1) }) });
const costSchema = z.object({ totalCost: z.number().finite().nonnegative() });
const pendingSchema = z.object({ statusCode: z.literal(404) });
const LOOKUP_ATTEMPTS = 10;
const LOOKUP_INTERVAL_MS = 2000;

export function gatewayGenerationId(metadata: unknown): string | null {
  const parsed = generationSchema.safeParse(metadata);
  // Missing usage metadata must not discard paid output; billing uses its named estimate rule.
  return parsed.success ? parsed.data.gateway.generationId : null;
}

export function gatewayCostCents(
  generation: unknown,
  context: { generationId: string; model: string },
): number {
  const parsed = costSchema.safeParse(generation);
  if (!parsed.success) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway returned no valid generation cost',
      context,
      { cause: parsed.error },
    );
  }
  return parsed.data.totalCost * 100;
}

export async function readGatewayCost(
  capability: MediaCapability,
  generationId: string | null,
  model: string,
): Promise<number> {
  const gateway = mediaGateway(capability);
  if (generationId === null) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Gateway returned no generation id', {
      model,
    });
  }
  try {
    return await retryWhile(
      async () =>
        gatewayCostCents(await gateway.getGenerationInfo({ id: generationId }), {
          generationId,
          model,
        }),
      {
        // Usage ingestion is asynchronous; only a missing record is retried.
        isRetryable: (cause) => pendingSchema.safeParse(cause).success,
        delays: Array<number>(LOOKUP_ATTEMPTS - 1).fill(LOOKUP_INTERVAL_MS),
      },
    );
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Gateway cost lookup failed',
      { generationId, model },
      { cause },
    );
  }
}
