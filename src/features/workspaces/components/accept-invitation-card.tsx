'use client';

import { useReducer } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAttemptToken } from '@/hooks/use-attempt-token';
import { captureException } from '@/lib/observability-client';
import { respondToInvitationAction } from '../api/invitation-actions';
import { invitationResponseReducer } from '../lib/invitation-response-machine';

const RESPONSE_FAILURE = {
  accepted: { message: 'Couldn’t accept the invitation. Try again.', op: 'invitation.accept' },
  rejected: { message: 'Couldn’t decline the invitation. Try again.', op: 'invitation.reject' },
} as const;

// Accepting atomically joins the workspace and selects it. The shell repairs provider setup.
export function AcceptInvitationCard({
  invitationId,
  inviterEmail,
}: {
  invitationId: string;
  inviterEmail: string;
}) {
  const [state, dispatch] = useReducer(invitationResponseReducer, { kind: 'idle' });
  const attempt = useAttemptToken();
  const pending =
    state.kind === 'submitting' ? (state.decision === 'accepted' ? 'accept' : 'decline') : null;

  async function respond(decision: 'accepted' | 'rejected') {
    if (state.kind !== 'idle') return;
    const token = attempt.begin();
    if (token === null) return;
    dispatch({ type: 'submit', decision, attempt: token });
    const failure = RESPONSE_FAILURE[decision];
    try {
      const outcome = await respondToInvitationAction({ invitationId, decision });
      if (!attempt.isCurrent(token)) return;
      if (!outcome.ok) {
        toast.error(failure.message, { description: outcome.message });
        dispatch({ type: 'failure', attempt: token });
        attempt.finish(token);
        return;
      }
      dispatch({ type: 'success', attempt: token });
      // Keep the accepted state through navigation so the invitation cannot be resubmitted.
      if (decision === 'accepted') window.location.assign('/app');
      else attempt.finish(token);
    } catch (cause) {
      if (!attempt.isCurrent(token)) return;
      captureException(cause, { op: failure.op });
      toast.error(failure.message);
      dispatch({ type: 'failure', attempt: token });
      attempt.finish(token);
    }
  }

  if (state.kind === 'rejected') {
    return (
      <p className="text-body text-muted-foreground" data-testid="invitation-declined">
        Invitation declined.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        <span className="font-medium text-foreground">{inviterEmail}</span> invited you.
      </p>
      <div className="flex gap-3">
        <Button
          type="button"
          onClick={() => void respond('accepted')}
          disabled={state.kind !== 'idle'}
          data-testid="accept-invitation"
        >
          {pending === 'accept' ? (
            <>
              <Spinner aria-hidden />
              Joining…
            </>
          ) : (
            'Accept invitation'
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void respond('rejected')}
          disabled={state.kind !== 'idle'}
        >
          {pending === 'decline' ? <Spinner aria-hidden /> : null}
          Decline
        </Button>
      </div>
    </div>
  );
}
