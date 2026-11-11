import { APIError } from 'better-auth/api';
import { AppError } from '@/lib/errors';

/**
 * Load an invitation while translating Better Auth's dead-link response into
 * an expected user state. Other failures keep their original error identity so
 * the page can distinguish wrong-account responses and report real failures.
 */
export async function getInvitation<T>(invitationId: string, lookup: () => Promise<T>): Promise<T> {
  try {
    return await lookup();
  } catch (cause) {
    if (cause instanceof APIError && cause.statusCode === 400) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Invitation is no longer valid',
        { invitationId, expectedState: true },
        { cause },
      );
    }
    throw cause;
  }
}
