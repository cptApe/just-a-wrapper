'use client';
import { z } from 'zod';
import type { ActionState } from '@/lib/action-state';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';

const emailSchema = z.email();
const EMAIL_CHANGE_CALLBACK = '/app/settings/account';
export async function requestEmailChange(
  email: string,
  newEmail: string,
): Promise<ActionState<{ email: string }>> {
  const parsed = emailSchema.safeParse(newEmail);
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_FAILED', message: 'Enter a valid email address' };
  }
  // Better Auth lowercases the address server-side; normalize here too so the
  // request target and the "Verification sent to …" line always agree.
  const normalized = parsed.data.toLowerCase();
  if (normalized === email.toLowerCase()) {
    return {
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'That is already your email address',
    };
  }
  try {
    const { error: changeError } = await authClient.changeEmail({
      newEmail: normalized,
      callbackURL: EMAIL_CHANGE_CALLBACK,
    });
    if (changeError) {
      return {
        ok: false,
        code: 'API_REQUEST_FAILED',
        message: changeError.message ?? 'Could not start the email change. Please try again.',
      };
    }
  } catch (cause) {
    captureException(cause, { op: 'account.change-email' });
    return {
      ok: false,
      code: 'API_REQUEST_FAILED',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
  return { ok: true, data: { email: normalized } };
}
