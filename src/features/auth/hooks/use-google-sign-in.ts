'use client';
import { toast } from 'sonner';
import { useAsyncAction } from '@/hooks/use-async-action';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';
export function useGoogleSignIn({
  afterAuth,
  returnToPath,
}: {
  afterAuth: string;
  returnToPath: string | null;
}) {
  const action = useAsyncAction();
  const { pending } = action;
  async function handleGoogle() {
    const token = action.begin();
    if (token === null) return;
    try {
      const { error } = await authClient.signIn.social({
        provider: 'google',
        callbackURL: afterAuth,
        // A refused sign-up lands back here with a notice instead of on Better
        // Auth's bare error page.
        errorCallbackURL: `/login?error=signup_disabled${returnToPath ? `&returnTo=${encodeURIComponent(returnToPath)}` : ''}`,
      });
      // On success the browser navigates to Google; only the error path returns
      // here, so we reset pending only when we are staying on the page.
      if (!action.isCurrent(token)) return;
      if (error) {
        toast.error('Couldn’t continue with Google. Try again.', {
          description: error.message,
        });
        action.finish(token);
      }
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'auth.signIn.google' });
      toast.error('Couldn’t continue with Google. Try again.');
      action.finish(token);
    }
  }

  return { pending, handleGoogle };
}
