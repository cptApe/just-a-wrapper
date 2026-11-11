'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { sendSignInCode } from '../api/send-sign-in-code';
export function useResendCode(email: string, action: ReturnType<typeof useAsyncAction>) {
  const [resent, setResent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  async function handleResend() {
    const token = action.begin();
    if (token === null) return;
    if (timer.current !== null) clearTimeout(timer.current);
    setResent(false);
    try {
      const sent = await sendSignInCode(email);
      if (!action.isCurrent(token)) return;
      if (sent) {
        setResent(true);
        timer.current = setTimeout(() => setResent(false), 3000);
      }
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'auth.resend-code' });
      toast.error('Couldn’t send that code. Try again.');
    } finally {
      action.finish(token);
    }
  }
  return { resent, handleResend };
}
