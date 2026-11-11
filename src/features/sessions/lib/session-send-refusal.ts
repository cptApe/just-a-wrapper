import { APIError } from '@anthropic-ai/sdk';
import { AppError } from '@/lib/errors';

// A lost response is not proof that the message was rejected. Keep its claim until the
// provider log resolves the ambiguity instead of letting a retry send the same opening twice.
export function isSessionSendRefused(cause: unknown): boolean {
  // These local validation codes are raised before events.send; post-send storage failures stay unconfirmed.
  if (
    cause instanceof AppError &&
    [
      'SESSION_BUSY',
      'SESSION_NOT_FOUND',
      'INVALID_BODY',
      'INTEGRATION_NOT_CONNECTED',
      'CREDITS_EXHAUSTED',
    ].includes(cause.code)
  )
    return true;
  return (
    cause instanceof APIError &&
    cause.status !== undefined &&
    cause.status >= 400 &&
    cause.status < 500 &&
    cause.status !== 408
  );
}
