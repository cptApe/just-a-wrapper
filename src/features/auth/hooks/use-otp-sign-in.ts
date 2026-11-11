'use client';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useAsyncAction } from '@/hooks/use-async-action';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';
export function useOtpSignIn(email: string, afterAuth: string) {
  const router = useRouter();
  const [otp, setOtp] = useState('');
  const action = useAsyncAction();
  const { pending } = action;
  async function handleOtp(e: FormEvent) {
    e.preventDefault();
    const token = action.begin();
    if (token === null) return;
    try {
      const { error } = await authClient.signIn.emailOtp({ email, otp });
      if (!action.isCurrent(token)) return;
      if (error) {
        toast.error('Couldn’t verify that code. Try again.', {
          description: error.message,
        });
        action.finish(token);
        return;
      }
      // Leave pending true through the navigation so the button can't be
      // re-submitted while the redirect resolves.
      router.push(afterAuth);
      router.refresh();
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'auth.signIn.emailOtp' });
      toast.error('Couldn’t verify that code. Try again.');
      action.finish(token);
    }
  }

  return { otp, setOtp, pending, action, handleOtp };
}
