'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { RowAction } from '@/components/settings/row-action';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { authClient } from '@/lib/auth-client';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { formatDate } from '@/lib/format/format-date';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';
import { respondToInvitationAction } from '../api/invitation-actions';
import type { PendingInvitationRow } from '../api/members';
import { invitationEmailWasSent } from '../lib/invitation-sent';
import { INVITE_ACTIONS_COL } from '../lib/members-row-geometry';
import { primaryRole, ROLE_LABEL } from '../lib/roles';

type BusyAction = { kind: 'resend' | 'cancel'; id: string };

// Pending invitations with cancel + resend (owner/admin only — the page hides
// the actions for members; Better Auth's cancel endpoint 403s them anyway).
// Resend is Better Auth's invite-member with `resend: true`: it renews unexpired invitations and replaces expired invitations. Expired rows stay
// listed with a status word precisely so they can be resent. Presentation is
// the settings row pattern: email + meta line, plain-text actions on the right.
export function PendingInvitations({
  invitations: serverInvitations,
  canManage,
  emailEnabled,
}: {
  invitations: PendingInvitationRow[];
  canManage: boolean;
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const expectedOrganizationId = useOrganizationId();
  const { timeZone } = useDisplayFormat();
  // One in-flight action at a time, so a double-click can't fire duplicate
  // cancels and each row shows its own state.
  const [busy, setBusy] = useState<BusyAction | null>(null);
  // Cancelled rows leave at once; the transition's refresh confirms it, a failure brings them back.
  const [invitations, removeInvitation] = useOptimistic(
    serverInvitations,
    (current: PendingInvitationRow[], id: string) => current.filter((row) => row.id !== id),
  );
  const [, startTransition] = useTransition();

  if (invitations.length === 0) {
    return (
      <p className="py-4 text-meta text-muted-foreground" data-testid="invitations-empty">
        No pending invitations. Invite someone above and they’ll show up here until they accept.
      </p>
    );
  }

  function run(
    action: BusyAction,
    fn: () => Promise<{ data?: unknown; error: { message?: string } | null }>,
  ) {
    if (busy) return;
    setBusy(action);
    startTransition(async () => {
      if (action.kind === 'cancel') removeInvitation(action.id);
      try {
        const { data, error } = await fn();
        if (error) {
          toast.error(error.message ?? 'That didn’t work. Please try again.');
          return;
        }
        if (action.kind === 'resend') {
          if (invitationEmailWasSent(data)) {
            toast.success('Invitation sent');
          } else {
            toast.error(
              'Invite created, but the email did not go out. Copy the link from Pending invitations.',
            );
          }
        }
        router.refresh();
      } catch (cause) {
        captureException(cause, { op: `workspace.invitation.${action.kind}` });
        toast.error('Could not reach the server. Check your connection and try again.');
      } finally {
        setBusy(null);
      }
    });
  }

  function resend(invitation: PendingInvitationRow) {
    if (!expectedOrganizationId) {
      toast.error('Reload to select your workspace before resending.');
      return;
    }
    const organizationId = expectedOrganizationId;
    run({ kind: 'resend', id: invitation.id }, () =>
      authClient.organization.inviteMember({
        organizationId,
        email: invitation.email,
        role: primaryRole(invitation.role),
        resend: true,
      }),
    );
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${id}`);
      toast.success('Invitation link copied');
    } catch (cause) {
      captureException(cause, { op: 'workspace.invitation.copy-link' });
      toast.error('Could not copy the invitation link. Please try again.');
    }
  }

  return (
    <ul className="flex flex-col" data-testid="pending-invitations">
      {invitations.map((inv) => {
        const expired = inv.expired;
        return (
          <li key={inv.id} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium">{inv.email}</p>
              <p className="truncate text-meta text-muted-foreground">
                Invited{inv.inviterName ? ` by ${inv.inviterName}` : ''} ·{' '}
                {expired ? 'expired' : `expires ${formatDate(inv.expiresAt, timeZone)}`}
              </p>
            </div>
            {/* Separate role/status metadata from a fixed-width action cell so buttons
             * and spinner states do not shift the row edge. */}
            <div className="flex shrink-0 items-center gap-6">
              <div className="flex items-center gap-2">
                <Badge variant="outline" shape="pill" className="hidden shrink-0 sm:inline-flex">
                  {ROLE_LABEL[primaryRole(inv.role)]}
                </Badge>
                <span
                  className={cn(
                    'text-meta font-medium',
                    expired ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {expired ? 'Expired' : 'Pending'}
                </span>
              </div>
              {canManage ? (
                <div className={cn(INVITE_ACTIONS_COL, 'flex items-center gap-4')}>
                  <RowAction onClick={() => copyLink(inv.id)} disabled={expired}>
                    Copy link
                  </RowAction>
                  {emailEnabled ? (
                    <RowAction disabled={busy !== null} onClick={() => resend(inv)}>
                      {busy?.kind === 'resend' && busy.id === inv.id ? (
                        <Spinner className="inline size-3.5" aria-hidden />
                      ) : null}{' '}
                      Resend
                    </RowAction>
                  ) : (
                    <RowAction
                      aria-disabled
                      className="opacity-50"
                      onClick={() => toast.error(CAPABILITY_OFF_MESSAGES.email)}
                    >
                      Resend
                    </RowAction>
                  )}
                  <RowAction
                    destructive
                    disabled={busy !== null}
                    data-testid={`cancel-invitation-${inv.email}`}
                    onClick={() =>
                      run({ kind: 'cancel', id: inv.id }, () =>
                        respondToInvitationAction({
                          invitationId: inv.id,
                          decision: 'canceled',
                        }).then((outcome) => ({
                          error: outcome.ok ? null : { message: outcome.message },
                        })),
                      )
                    }
                  >
                    {busy?.kind === 'cancel' && busy.id === inv.id ? (
                      <Spinner className="inline size-3.5" aria-hidden />
                    ) : null}{' '}
                    Cancel
                  </RowAction>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
