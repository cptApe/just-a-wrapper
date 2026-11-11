'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthForm } from '../hooks/use-auth-form';
import { useAuthNavigation } from '../hooks/use-auth-navigation';
import { AuthEmailStep } from './auth-email-step';
import { AuthOtpStep } from './auth-otp-step';

export function AuthForm({
  returnTo,
  emailEnabled,
  googleEnabled,
  signupRefused = false,
}: {
  returnTo?: string;
  emailEnabled: boolean;
  /** False hides the Google button (no real Google client id in this deployment). */
  googleEnabled: boolean;
  /** True when Google sent the visitor back because their account is new. */
  signupRefused?: boolean;
}) {
  const form = useAuthForm(signupRefused);
  const { step, email } = form;
  const navigation = useAuthNavigation(returnTo);
  const { devSignInVisible, returnToPath } = navigation;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step === 'closed') headingRef.current?.focus();
  }, [step]);
  return (
    <div className="w-full max-w-sm">
      <div className="mb-10 flex flex-col items-center text-center">
        <h1 ref={headingRef} tabIndex={-1} className="text-foreground text-title-page outline-none">
          {step === 'email'
            ? 'Log in'
            : step === 'otp'
              ? 'Check your email'
              : 'Sign-ups are closed'}
        </h1>
        {step === 'otp' && (
          <p className="mt-2 text-body text-muted-foreground">
            Enter the 6-digit code we sent to{' '}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        )}
      </div>

      {step === 'closed' && (
        <Button
          type="button"
          variant="link"
          size="lg"
          className="w-full"
          onClick={() => {
            form.setEmail('');
            form.goToStep('email');
          }}
        >
          Use a different email
        </Button>
      )}
      {step === 'email' && (
        <AuthEmailStep
          form={form}
          navigation={navigation}
          emailEnabled={emailEnabled}
          googleEnabled={googleEnabled}
          googleIcon={<GoogleIcon />}
        />
      )}
      {step === 'otp' && <AuthOtpStep form={form} afterAuth={navigation.afterAuth} />}

      {devSignInVisible && (step === 'email' || step === 'otp') && (
        <a
          href={
            returnToPath
              ? `/api/dev/login?returnTo=${encodeURIComponent(returnToPath)}`
              : '/api/dev/login'
          }
          className="mt-6 flex items-center justify-center gap-2 rounded-button border border-alpha-16 border-dashed px-4 py-2.5 text-meta font-medium text-muted-foreground transition-colors hover:border-alpha-24 hover:text-foreground"
        >
          Dev sign-in (skip OTP)
        </a>
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <title>Google</title>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}
