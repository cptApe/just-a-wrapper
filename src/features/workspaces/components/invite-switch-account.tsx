'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { loginUrlWithReturnTo } from '@/features/auth/lib/return-to';
import { useAsyncAction } from '@/hooks/use-async-action';
import { resetIdentity } from '@/lib/analytics-client';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';

// "Switch account" for the wrong-recipient state on /invite/[id]: signs the
// current user out and returns to login with the invite as the post-auth
// destination, so signing in with the invited address lands right back here.
export function InviteSwitchAccount({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const action = useAsyncAction();
  const { pending } = action;

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={async () => {
        const token = action.begin();
        if (token === null) return;
        try {
          const response = await authClient.signOut();
          if (!action.isCurrent(token)) return;
          if (response.error) {
            toast.error('Couldn’t sign out. Try again.');
            action.finish(token);
            return;
          }
          // Drop the PostHog identity so signing in as the invited address starts
          // a fresh profile rather than stitching onto the prior person.
          resetIdentity();
          router.push(loginUrlWithReturnTo(`/invite/${invitationId}`));
        } catch (cause) {
          if (!action.isCurrent(token)) return;
          captureException(cause, { op: 'invitation.switch-account' });
          toast.error('Couldn’t sign out. Try again.');
          action.finish(token);
        }
      }}
    >
      {pending ? 'Signing out…' : 'Switch account'}
    </Button>
  );
}
