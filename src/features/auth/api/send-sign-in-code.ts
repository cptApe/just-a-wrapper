'use client';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';

function otpErrorMessage(error: { status?: number; message?: string } | null): string {
  if (error?.status === 429) {
    return 'Too many emails sent to this address. Wait a minute, then try again.';
  }
  return error?.message ?? 'Could not send a code. Please try again.';
}

export async function sendSignInCode(email: string) {
  try {
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    });
    if (error) {
      toast.error('Couldn’t send a code. Try again.', {
        description: otpErrorMessage(error),
      });
      return false;
    }
    return true;
  } catch (cause) {
    captureException(cause, { op: 'auth.emailOtp.send' });
    toast.error('Couldn’t send a code. Try again.');
    return false;
  }
}
