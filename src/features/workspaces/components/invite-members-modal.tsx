'use client';

import { useRouter } from 'next/navigation';
import { useReducer, useState } from 'react';
import { toast } from 'sonner';
import { IconCheckCircle, IconLock01, IconPlus, IconXCircle } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DelayedTooltip } from '@/components/ui/tooltip';
import { useAttemptToken } from '@/hooks/use-attempt-token';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { sendInvitations } from '../api/send-invitations';
import { inviteMembersReducer } from '../lib/invite-members-machine';
import { parseInviteEmails } from '../lib/parse-invite-emails';
import {
  inviteRoleBlockedReason,
  ROLE_LABEL,
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '../lib/roles';

// Non-admins see the button disabled with a reason: controls disable, they don't vanish.

// Least-privileged first: 'member' is the common invite, so it leads and is the
// default. (WORKSPACE_ROLES is most-privileged first for the display order.)
const ROLE_OPTIONS: readonly WorkspaceRole[] = [...WORKSPACE_ROLES].reverse();

export function InviteMembers({
  canInvite,
  viewerRole,
  emailEnabled,
}: {
  canInvite: boolean;
  viewerRole: WorkspaceRole;
  emailEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <Button
      size="sm"
      disabled={!canInvite}
      onClick={() => setOpen(true)}
      data-testid="add-member-button"
    >
      {canInvite ? (
        <IconPlus className="size-4" aria-hidden />
      ) : (
        <IconLock01 className="size-4" aria-hidden />
      )}
      Add members
    </Button>
  );

  return (
    <>
      {canInvite ? (
        trigger
      ) : (
        <DelayedTooltip content="Only workspace admins can add members" side="bottom" delay={300}>
          {/* A disabled button emits no pointer events, so the tooltip needs a
              live wrapper to sense hover/focus. */}
          <span
            role="group"
            aria-label="Add members. Only workspace admins can add members."
            tabIndex={0}
            className="inline-flex rounded-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {trigger}
          </span>
        </DelayedTooltip>
      )}
      {canInvite && open ? (
        <InviteModal
          open={open}
          onOpenChange={setOpen}
          viewerRole={viewerRole}
          emailEnabled={emailEnabled}
        />
      ) : null}
    </>
  );
}

function InviteModal({
  open,
  onOpenChange,
  viewerRole,
  emailEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewerRole: WorkspaceRole;
  emailEnabled: boolean;
}) {
  const router = useRouter();
  const expectedOrganizationId = useOrganizationId();
  const [state, dispatch] = useReducer(inviteMembersReducer, {
    kind: 'editing',
    raw: '',
    role: 'member',
    results: [],
    error: null,
  });
  const { raw, role } = state;
  const pending = state.kind === 'sending';
  const results = state.kind === 'editing' ? state.results : [];
  const error = state.kind === 'editing' ? state.error : null;
  const attempt = useAttemptToken();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!expectedOrganizationId) {
      dispatch({
        type: 'invalid',
        message: 'Reload to select your workspace before inviting members.',
      });
      return;
    }
    const { valid, invalid } = parseInviteEmails(raw);
    if (valid.length === 0) {
      dispatch({ type: 'invalid', message: 'Enter at least one valid email address.' });
      return;
    }
    if (invalid.length > 0) {
      dispatch({ type: 'invalid', message: `These don’t look like emails: ${invalid.join(', ')}` });
      return;
    }
    const token = attempt.begin();
    if (token === null) return;
    dispatch({ type: 'send', attempt: token });
    const next = await sendInvitations(valid, role, expectedOrganizationId);
    if (!attempt.finish(token)) return;
    dispatch({ type: 'finish', attempt: token, results: next });

    const created = next.filter((r) => r.ok);
    const sent = created.filter((r) => r.data.emailSent);
    const undelivered = created.filter((r) => !r.data.emailSent);
    const failed = next.filter((r) => !r.ok);
    // Refresh regardless so any invites that DID go out appear in Pending.
    if (created.length > 0) router.refresh();
    if (!emailEnabled && created.length > 0) {
      toast.success(
        created.length === 1
          ? 'Invitation created. Copy the link to share it.'
          : `${created.length} invitations created. Copy the links to share them.`,
      );
    } else if (undelivered.length > 0) {
      toast.error(
        'Invite created, but the email did not go out. Copy the link from Pending invitations.',
      );
    } else if (failed.length === 0) {
      toast.success(sent.length === 1 ? 'Invitation sent' : `${sent.length} invitations sent`);
    }
    // A failure keeps the modal open: its per-email breakdown names what to retry.
    if (failed.length === 0) onOpenChange(false);
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (pending) return; // don't hide an in-flight batch
        onOpenChange(next);
      }}
      size="sm"
    >
      <ModalHeader>
        <ModalTitle>Add members</ModalTitle>
      </ModalHeader>
      <Form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <ModalContent className="gap-4">
          {emailEnabled ? null : (
            <p role="status" className="text-meta text-muted-foreground">
              {CAPABILITY_OFF_MESSAGES.email} You can still copy each invite link.
            </p>
          )}
          <InviteFields
            raw={raw}
            setRaw={(raw) => dispatch({ type: 'raw', raw })}
            role={role}
            setRole={(role) => dispatch({ type: 'role', role })}
            viewerRole={viewerRole}
          />

          {error ? (
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          ) : null}

          {results.length > 0 ? (
            <ul className="flex flex-col gap-1.5" data-testid="invite-results">
              {results.map((r) => (
                <li key={r.email} className="flex items-center gap-2 text-meta">
                  {r.ok && (r.data.emailSent || !emailEnabled) ? (
                    <IconCheckCircle className="size-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <IconXCircle className="size-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span className="truncate">{r.email}</span>
                  {r.ok && !r.data.emailSent ? (
                    <span className="text-muted-foreground">
                      {emailEnabled
                        ? 'Email not sent. Copy the link from Pending invitations.'
                        : 'Copy the link from Pending invitations.'}
                    </span>
                  ) : null}
                  {!r.ok && r.message ? (
                    <span className="truncate text-muted-foreground">{r.message}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </ModalContent>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={pending || raw.trim().length === 0}
            data-testid="invite-submit"
          >
            {pending ? 'Sending…' : emailEnabled ? 'Send invitations' : 'Create invitations'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

function InviteFields({
  raw,
  setRaw,
  role,
  setRole,
  viewerRole,
}: {
  raw: string;
  setRaw: (raw: string) => void;
  role: WorkspaceRole;
  setRole: (role: WorkspaceRole) => void;
  viewerRole: WorkspaceRole;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-emails">Email addresses</Label>
        <Textarea
          id="invite-emails"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="teammate@company.com, another@company.com"
          rows={3}
          aria-label="Email addresses to invite"
          data-testid="invite-emails-input"
          // This modal exists to enter invitees, so focus belongs here.
          autoFocus
        />
        <p className="text-meta text-muted-foreground">
          Separate several with commas or new lines.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="invite-role">Role</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            const nextRole = WORKSPACE_ROLES.find((role) => role === value);
            if (nextRole) setRole(nextRole);
          }}
        >
          <SelectTrigger id="invite-role" className="max-w-40" data-testid="invite-role-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((value) => {
              // Better Auth refuses an owner invite from a non-owner, so the option says why first.
              const blockedReason = inviteRoleBlockedReason(viewerRole, value);
              const item = (
                <SelectItem key={value} value={value} disabled={blockedReason !== null}>
                  {ROLE_LABEL[value]}
                </SelectItem>
              );
              return blockedReason ? (
                <DelayedTooltip key={value} content={blockedReason} side="right" delay={300}>
                  {/* A disabled item emits no pointer events, so a live wrapper senses hover. */}
                  <span className="block">{item}</span>
                </DelayedTooltip>
              ) : (
                item
              );
            })}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
