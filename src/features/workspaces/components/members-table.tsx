'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useOptimistic, useReducer, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { IconSearchMd } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal, ModalClose, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
// Direct hook import (client): the realtime barrel re-exports the server-only
// publish helper, which must never reach a client bundle.
import { useAttemptToken } from '@/hooks/use-attempt-token';
import { captureException } from '@/lib/observability-client';
import { removeWorkspaceMemberAction } from '../api/member-removal-actions';
import { updateWorkspaceMemberRoleAction } from '../api/member-role-actions';
import { memberMutationReducer } from '../lib/member-mutation-machine';
import { ROLE_LABEL, type WorkspaceRole } from '../lib/roles';
import { MemberTableRow } from './member-table-row';

// The server sends fully shaped rows; this file only presents and mutates them.
// Role and removal changes run through locked server actions so two owners cannot
// remove each other. The UI mirrors those gates to explain a blocked action first.

export type MemberListItem = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  // The signed-in person's own row: they leave through workspace settings, not removal.
  isViewer: boolean;
  lastActiveLabel: string;
  creditsUsed: number | null;
};

type MembersEdit = (members: MemberListItem[]) => MemberListItem[];

export function MembersTable({
  members: serverMembers,
  isAdmin,
  viewerRole,
}: {
  members: MemberListItem[];
  isAdmin: boolean;
  viewerRole: WorkspaceRole;
}) {
  const router = useRouter();
  // Rows are server props, so edits hold through the transition's refresh and revert if it fails.
  const [members, editMembers] = useOptimistic(
    serverMembers,
    (current: MemberListItem[], edit: MembersEdit) => edit(current),
  );
  const [, startTransition] = useTransition();
  const [mutation, dispatchMutation] = useReducer(memberMutationReducer, { kind: 'idle' });
  const attempt = useAttemptToken();
  const [query, setQuery] = useState('');
  // One in-flight mutation at a time, keyed by memberId, so a double-click can't
  // fire duplicate role changes and each row shows its own spinner.
  const busyMemberId = mutation.kind === 'pending' ? mutation.memberId : null;
  // Holds the member through the dialog's exit animation, so the title never reads "Remove ?".
  const [removal, setRemoval] = useState<{ member: MemberListItem; open: boolean } | null>(null);

  const ownerCount = useMemo(() => members.filter((m) => m.role === 'owner').length, [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, query]);

  function runMutation(
    memberId: string,
    op: string,
    edit: MembersEdit,
    fn: () => Promise<{ error: { message?: string } | null }>,
    onOk: () => void,
  ) {
    const token = attempt.begin();
    if (token === null) return;
    dispatchMutation({ type: 'start', memberId, attempt: token });
    startTransition(async () => {
      editMembers(edit);
      try {
        const { error } = await fn();
        if (!attempt.isCurrent(token)) return;
        if (error) {
          toast.error(error.message ?? 'That didn’t work. Please try again.');
          return;
        }
        onOk();
        router.refresh();
      } catch (cause) {
        if (!attempt.isCurrent(token)) return;
        captureException(cause, { op });
        toast.error('Could not reach the server. Check your connection and try again.');
      } finally {
        attempt.finish(token);
        dispatchMutation({ type: 'finish', attempt: token });
      }
    });
  }

  function changeRole(m: MemberListItem, nextRole: WorkspaceRole) {
    if (nextRole === m.role) return;
    runMutation(
      m.memberId,
      'workspace.member.update-role',
      (current) =>
        current.map((row) => (row.memberId === m.memberId ? { ...row, role: nextRole } : row)),
      async () => {
        const result = await updateWorkspaceMemberRoleAction({
          memberId: m.memberId,
          role: nextRole,
        });
        return { error: result.ok ? null : result };
      },
      () => toast.success(`${m.name || m.email} is now ${ROLE_LABEL[nextRole].toLowerCase()}`),
    );
  }

  function confirmRemoveMember() {
    if (removal === null) return;
    const m = removal.member;
    setRemoval({ member: m, open: false });
    runMutation(
      m.memberId,
      'workspace.member.remove',
      (current) => current.filter((row) => row.memberId !== m.memberId),
      async () => {
        const result = await removeWorkspaceMemberAction({ memberId: m.memberId });
        return { error: result.ok ? null : result };
      },
      () => toast.success(`${m.name || m.email} was removed`),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <IconSearchMd
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search members"
          className="pl-9"
          data-testid="members-search"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-4 text-meta text-muted-foreground" data-testid="members-empty">
          {query.trim() ? `No members match “${query.trim()}”` : 'No members yet'}
        </p>
      ) : (
        <ul className="flex flex-col" data-testid="members-list">
          {filtered.map((member) => (
            <MemberTableRow
              key={member.memberId}
              member={member}
              isAdmin={isAdmin}
              viewerRole={viewerRole}
              ownerCount={ownerCount}
              busy={busyMemberId === member.memberId}
              changeRole={changeRole}
              setConfirmRemove={(member) => setRemoval({ member, open: true })}
            />
          ))}
        </ul>
      )}

      {removal ? (
        <ConfirmMemberRemoval
          member={removal.member}
          open={removal.open}
          busy={busyMemberId !== null}
          onDismiss={() => setRemoval({ member: removal.member, open: false })}
          onConfirm={confirmRemoveMember}
        />
      ) : null}
    </div>
  );
}

function ConfirmMemberRemoval({
  member,
  open,
  busy,
  onDismiss,
  onConfirm,
}: {
  member: MemberListItem;
  open: boolean;
  busy: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // Don't dismiss mid-remove; otherwise the outcome toast has no anchor.
        if (!next && !busy) onDismiss();
      }}
      size="sm"
    >
      {/* Title-only, body-free: the member's name is the whole question. Not a
            type-to-confirm — that gravity is reserved for workspace/account
            deletion. */}
      <ModalHeader>
        <ModalTitle>Remove {member.name || member.email}?</ModalTitle>
      </ModalHeader>
      <ModalFooter>
        <ModalClose asChild>
          <Button type="button" variant="ghost" disabled={busy}>
            Cancel
          </Button>
        </ModalClose>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          variant="destructive-solid"
          data-testid="confirm-remove-member"
        >
          {busy ? <Spinner aria-hidden /> : null}
          {busy ? 'Removing…' : 'Remove'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
