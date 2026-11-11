'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { useAuthFocus } from '../hooks/use-auth-focus';
import type { useAuthForm } from '../hooks/use-auth-form';
import type { useAuthNavigation } from '../hooks/use-auth-navigation';
import { useEmailSignIn } from '../hooks/use-email-sign-in';

const pillField = 'h-11 rounded-button px-4';

function OffReason({ children }: { children: string }) {
  return <p className="text-center text-meta text-muted-foreground">{children}</p>;
}

export function AuthEmailStep({
  form,
  navigation,
  emailEnabled,
  googleEnabled,
  googleIcon,
}: {
  form: ReturnType<typeof useAuthForm>;
  navigation: ReturnType<typeof useAuthNavigation>;
  emailEnabled: boolean;
  googleEnabled: boolean;
  googleIcon: React.ReactNode;
}) {
  const { email, setEmail, goToStep } = form;
  const { pending, handleGoogle, handleEmail } = useEmailSignIn(email, goToStep, navigation);
  const emailRef = useAuthFocus<HTMLInputElement>();
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        size="lg"
        onClick={handleGoogle}
        disabled={pending || !googleEnabled}
        className="w-full gap-2.5"
      >
        {googleIcon}
        Continue with Google
      </Button>
      {/* Google has no in-flight label of its own; the form-wide pending flag
              still disables it so a slow email send can't race a social sign-in. */}
      {googleEnabled ? null : <OffReason>{CAPABILITY_OFF_MESSAGES.googleSignIn}</OffReason>}

      <div className="my-2 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-meta font-medium text-foreground-tertiary">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Form onSubmit={handleEmail} className="flex flex-col gap-3">
        <Input
          ref={emailRef}
          type="email"
          disabled={pending || !emailEnabled}
          required
          autoComplete="email"
          placeholder="Enter email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
          className={pillField}
        />
        <Button
          type="submit"
          size="lg"
          disabled={pending || !email || !emailEnabled}
          className="w-full"
        >
          {pending ? (
            <>
              <Spinner aria-hidden />
              Sending…
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </Form>
      {emailEnabled ? null : <OffReason>{CAPABILITY_OFF_MESSAGES.emailSignIn}</OffReason>}

      <p className="pt-1 text-center text-meta text-foreground-tertiary">
        By continuing, you accept our{' '}
        <Link href="/privacy" className="text-muted-foreground underline-offset-4 hover:underline">
          Privacy policy
        </Link>
        .
      </p>
    </div>
  );
}
