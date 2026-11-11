import { AppError, type ErrorCode } from '@/lib/errors';
import type { MediaBilling } from '@/lib/media-billing';

/** What a failed call still owes its provider: a media charge resolved later, or a known amount. */
export type PaidToolCost = { mediaBilling: MediaBilling } | { vendorCostCents: number };

// A tool that fails after its provider charged throws this, so the dispatcher bills the
// failure exactly as it bills a success.
export class PaidToolError extends AppError {
  readonly cost: PaidToolCost;

  constructor(input: {
    cost: PaidToolCost;
    code?: ErrorCode;
    message: string;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.code ?? 'EXTERNAL_API_FAILED', input.message, input.context ?? {}, {
      cause: input.cause,
    });
    this.cost = input.cost;
  }
}

/** A generation succeeded but its output could not be saved; the generation is still owed. */
export function unsavedMediaError(mediaBilling: MediaBilling, cause: unknown): PaidToolError {
  return new PaidToolError({
    cost: { mediaBilling },
    message: 'Generated media could not be saved',
    context: { model: mediaBilling.model },
    cause,
  });
}
