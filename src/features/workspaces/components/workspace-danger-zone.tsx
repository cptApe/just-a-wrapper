'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { DangerConfirmDialog } from '@/components/settings/danger-confirm-dialog';
import { RowAction } from '@/components/settings/row-action';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import { deleteWorkspace, leaveWorkspace } from '../api/danger-actions';

// Workspace leave and delete use borderless danger rows.
// Unavailable role-gated actions stay visible with a disabled-state reason.
// Leave uses confirmation; delete requires typing the name. Success refreshes /app.

export function WorkspaceDangerZone({
  workspaceId,
  workspaceName,
  leaveBlockedReason,
  deleteBlockedReason,
}: {
  workspaceId: string;
  workspaceName: string;
  /** Non-null disables Leave and is shown as the tooltip reason. */
  leaveBlockedReason: string | null;
  /** Non-null disables Delete and is shown as the tooltip reason. */
  deleteBlockedReason: string | null;
}) {
  // Hand-rolled to keep the SettingsSection rhythm (pt-12 first:pt-0, gap-1
  // header, pt-2 row stack) while coloring the heading destructive — the one
  // divergence from the neutral section style, carrying the danger signal.
  return (
    <section className="flex flex-col gap-1 pt-12 first:pt-0">
      <h2 className="text-title-section text-destructive">Danger zone</h2>
      <div className="flex flex-col pt-2">
        <LeaveRow workspaceName={workspaceName} blockedReason={leaveBlockedReason} />
        <DeleteRow
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          blockedReason={deleteBlockedReason}
        />
      </div>
    </section>
  );
}

// A disabled destructive action that keeps a tooltip reason (never vanishes). The
// trigger is a focusable span so the tip is reachable by keyboard even though the
// action underneath is inert. No lock glyph — the disabled state + reason carry it.
function LockedAction({ reason, label }: { reason: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* The disabled RowAction can't take focus or fire the tooltip, so the
            span is the tab stop — and carries the focus ring itself (the inner
            button's ring never fires while disabled). */}
        <span
          tabIndex={0}
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <RowAction destructive disabled>
            {label}
          </RowAction>
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function LeaveRow({
  workspaceName,
  blockedReason,
}: {
  workspaceName: string;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const expectedOrganizationId = useOrganizationId();
  const [open, setOpen] = useState(false);
  const action = useAsyncAction();
  const { pending } = action;

  async function confirmLeave() {
    if (expectedOrganizationId === null) {
      toast.error('Select a workspace before leaving it.');
      return;
    }
    const token = action.begin();
    if (token === null) return;
    try {
      const result = await leaveWorkspace(expectedOrganizationId);
      if (!action.isCurrent(token)) return;
      if (!result.ok) {
        if (reloadWorkspaceChanged({ code: result.code })) return;
        toast.error('Couldn’t leave the workspace. Try again.', {
          description: result.message,
        });
        action.finish(token);
        return;
      }
      action.finish(token);
      toast.success('You left the workspace');
      setOpen(false);
      router.push('/app');
      router.refresh();
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'workspace.leave' });
      toast.error('Couldn’t leave the workspace. Try again.');
      action.finish(token);
    }
  }

  return (
    <>
      <SettingsDetailRow
        layout="stacked"
        label="Leave workspace"
        value="Remove yourself from this workspace."
        action={
          blockedReason ? (
            <LockedAction reason={blockedReason} label="Leave workspace" />
          ) : (
            <RowAction destructive onClick={() => setOpen(true)}>
              Leave workspace
            </RowAction>
          )
        }
      />
      {blockedReason ? null : (
        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
          presentation="dialog"
          size="sm"
        >
          <ModalHeader>
            <ModalTitle>Leave this workspace</ModalTitle>
          </ModalHeader>
          <ModalContent>
            <ModalDescription className="text-body text-muted-foreground">
              You will lose access to {workspaceName} and everything in it. An owner or admin can
              re-invite you later.
            </ModalDescription>
          </ModalContent>
          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </ModalClose>
            <Button
              type="button"
              onClick={confirmLeave}
              disabled={pending}
              variant="destructive-solid"
            >
              {pending ? <Spinner aria-hidden /> : null}
              {pending ? 'Leaving…' : 'Leave workspace'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}

function DeleteRow({
  workspaceId,
  workspaceName,
  blockedReason,
}: {
  workspaceId: string;
  workspaceName: string;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <SettingsDetailRow
        layout="stacked"
        label="Delete workspace"
        value="Delete this workspace for everyone."
        action={
          blockedReason ? (
            <LockedAction reason={blockedReason} label="Delete workspace" />
          ) : (
            <RowAction destructive onClick={() => setOpen(true)}>
              Delete workspace
            </RowAction>
          )
        }
      />
      {blockedReason ? null : (
        <DangerConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Delete this workspace"
          description={
            <>This permanently deletes {workspaceName} for every member. This cannot be undone.</>
          }
          confirmPhrase={workspaceName}
          confirmLabel="Delete workspace"
          pendingLabel="Deleting…"
          // Trim both sides so stray leading/trailing whitespace doesn't block a
          // correct name (the server trims both sides too).
          normalize={(value) => value.trim()}
          onConfirm={async (typed) => {
            try {
              // Forward the actual typed value; the server re-validates it against
              // the current workspace name so the type-to-confirm is truly enforced.
              const result = await deleteWorkspace({ confirmName: typed, workspaceId });
              if (!result.ok) {
                if (reloadWorkspaceChanged({ code: result.code })) return false;
                toast.error('Couldn’t delete the workspace. Try again.', {
                  description: result.message,
                });
                return false;
              }
            } catch (cause) {
              captureException(cause, { op: 'workspace.delete' });
              toast.error('Couldn’t delete the workspace. Try again.');
              return false;
            }
            toast.success('Workspace deleted');
            router.push('/app');
            router.refresh();
            return true;
          }}
        />
      )}
    </>
  );
}
