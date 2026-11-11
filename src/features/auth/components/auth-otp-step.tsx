'use client';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAuthFocus } from '../hooks/use-auth-focus';
import type { useAuthForm } from '../hooks/use-auth-form';

const pillField = 'h-11 rounded-button px-4';

import { useOtpSignIn } from '../hooks/use-otp-sign-in';
import { useResendCode } from '../hooks/use-resend-code';
export function AuthOtpStep({
  form,
  afterAuth,
}: {
  form: ReturnType<typeof useAuthForm>;
  afterAuth: string;
}) {
  const { email, goToStep } = form;
  const { otp, setOtp, pending, action, handleOtp } = useOtpSignIn(email, afterAuth);
  const { resent, handleResend } = useResendCode(email, action);
  const otpRef = useAuthFocus<HTMLInputElement>();
  return (
    <Form onSubmit={handleOtp} className="flex flex-col gap-3">
      <Input
        ref={otpRef}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        required
        placeholder="000000"
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        aria-label="Verification code"
        className={`${pillField} text-center font-mono text-body-lg tracking-[0.5em] sm:text-body-lg`}
      />
      <Button type="submit" size="lg" disabled={pending || otp.length < 6} className="w-full">
        {pending ? (
          <>
            <Spinner aria-hidden />
            Verifying…
          </>
        ) : (
          'Verify & continue'
        )}
      </Button>
      <div className="mt-1 flex items-center justify-center gap-4 text-meta">
        <button
          type="button"
          onClick={handleResend}
          disabled={pending}
          className="max-sm:min-h-11 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {resent ? 'Code sent ✓' : 'Resend code'}
        </button>
        <span className="text-foreground-tertiary">·</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (pending) return;
            goToStep('email');
          }}
          className="max-sm:min-h-11 text-muted-foreground transition-colors hover:text-foreground"
        >
          Use a different email
        </button>
      </div>
    </Form>
  );
}
