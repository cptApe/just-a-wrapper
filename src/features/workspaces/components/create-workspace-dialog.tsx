'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';

// Type-only import — erased at compile time, so the registry→overlay→registry
// module loop never exists at runtime.
import type { OverlayComponentProps } from '@/features/overlays';
import { useOverlayCloseGuard } from '@/features/overlays/hooks/use-overlay-close-guard';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { createWorkspaceAction } from '../api/actions';

const DEFAULT_NAME = 'My team';

// Create and provision the workspace, activate it, then open it.
// Use a full document load because stale client prefetches can preserve the wrong workspace.
// A fresh hash-overlay mount selects the initial name; Enter submits.
export function CreateWorkspaceOverlay({ open, onClose }: OverlayComponentProps) {
  const [name, setName] = useState(DEFAULT_NAME);
  const action = useAsyncAction();
  const { pending } = action;
  useOverlayCloseGuard(pending);
  const canCreate = name.trim().length > 0 && !pending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    const token = action.begin();
    if (token === null) return;
    try {
      const result = await createWorkspaceAction(name.trim());
      if (!action.isCurrent(token)) return;
      if (!result.ok) {
        action.finish(token);
        toast.error('Couldn’t create the workspace. Try again.', {
          description: result.message,
        });
        return;
      }
      // Keep the spinner on through the navigation; the document unloads with it.
      window.location.assign('/app');
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      captureException(cause, { op: 'workspace.create' });
      action.finish(token);
      toast.error('Couldn’t create the workspace. Try again.');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // The action is in flight — closing now would hide the outcome.
        if (pending) return;
        if (!next) onClose();
      }}
      size="sm"
    >
      <ModalHeader>
        <ModalTitle>Create workspace</ModalTitle>
      </ModalHeader>
      <Form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <ModalContent className="gap-4">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Workspace name"
            maxLength={100}
            data-testid="create-workspace-name"
            // This modal exists to name the workspace, so focus belongs here.
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canCreate} data-testid="create-workspace-submit">
            {pending ? <Spinner aria-hidden /> : null}
            {pending ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
