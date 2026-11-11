import 'server-only';
import type { MediaCapability } from '@/lib/capabilities';
import type { MediaBilling } from '@/lib/media-billing';
import { readGatewayCost } from '@/lib/media-gateway';
import { captureException } from '@/lib/observability';

export async function resolveMediaCost(
  capability: MediaCapability,
  billing: MediaBilling,
): Promise<number> {
  try {
    return await readGatewayCost(capability, billing.generationId, billing.model);
  } catch (error) {
    // Paid output is delivered even when usage lookup fails; bill the preflight estimate and report it.
    captureException(error, { feature: 'billing', recovery: 'media-estimate', ...billing });
    return billing.estimatedCostCents;
  }
}
