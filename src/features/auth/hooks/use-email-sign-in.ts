'use client';
import { type FormEvent } from 'react';
import { toast } from 'sonner';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { sendSignInCode } from '../api/send-sign-in-code';
import { checkSignInEligibility } from '../api/sign-in-eligibility';
import type { AuthStep } from '../types';
import { useGoogleSignIn } from './use-google-sign-in';
export function useEmailSignIn(
  email: string,
  goToStep: (step: AuthStep) => void,
  navigation: { afterAuth: string; returnToPath: string | null },
) {
  const action = useAsyncAction();
  const { pending } = action;
  const google = useGoogleSignIn(navigation);
  async function handleEmail(e: FormEvent) {
    e.preventDefault();
    const token = action.begin();
    if (token === null) return;
    try {
      const eligibility = await checkSignInEligibility(email);
      if (!action.isCurrent(token)) return;
      if (eligibility.status !== 'eligible') {
        if (eligibility.status === 'no-account') {
          goToStep('closed');
        } else {
          toast.error(
            eligibility.status === 'invalid'
              ? 'Enter a valid email address.'
              : 'Too many checks for this address. Wait a minute, then try again.',
          );
        }
        return;
      }
      const sent = await sendSignInCode(email);
      if (action.isCurrent(token) && sent) goToStep('otp');
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'auth.signIn.eligibility' });
      toast.error('Couldn’t check your email. Try again.');
    } finally {
      action.finish(token);
    }
  }

  return { pending: pending || google.pending, handleGoogle: google.handleGoogle, handleEmail };
}
