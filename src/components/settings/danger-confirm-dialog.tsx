'use client';

import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
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
import { useAsyncAction } from '@/hooks/use-async-action';

import { captureException } from '@/lib/observability-client';

// Filled destructive styling is reserved for the final confirmation step, not the action that opens it.
export function DangerConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel,
  pendingLabel = 'Deleting…',
  onConfirm,
  normalize,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The warning body — say what is destroyed and what is recoverable. */
  description: React.ReactNode;
  /** The exact string the user must type (their email / the workspace name). */
  confirmPhrase: string;
  /** Verb-first red action ("Delete account", "Delete workspace"). */
  confirmLabel: string;
  pendingLabel?: string;
  /** Receives the confirmed value. Return (or resolve) `false` to keep the
      dialog open after a failure. */
  onConfirm: (typed: string) => boolean | undefined | Promise<boolean | undefined>;
  /** Normalizes both the typed value and the phrase before comparison — e.g.
      case-insensitive email match. Defaults to an exact (case-sensitive) match. */
  normalize?: (value: string) => string;
  /** Extra content between the description and the confirm field. */
  children?: React.ReactNode;
}) {
  const action = useAsyncAction();

  function handleOpenChange(next: boolean) {
    if (action.pending) return;
    onOpenChange(next);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange} presentation="dialog" size="sm">
      {/* The form (and its typed/pending state) lives INSIDE the modal, so it
          unmounts on close and every open starts from a blank, disabled confirm. */}
      <DangerConfirmForm
        action={action}
        title={title}
        description={description}
        confirmPhrase={confirmPhrase}
        confirmLabel={confirmLabel}
        pendingLabel={pendingLabel}
        onConfirm={onConfirm}
        normalize={normalize}
        close={() => onOpenChange(false)}
      >
        {children}
      </DangerConfirmForm>
    </Modal>
  );
}

function DangerConfirmForm({
  action,
  title,
  description,
  confirmPhrase,
  confirmLabel,
  pendingLabel,
  onConfirm,
  normalize,
  close,
  children,
}: {
  action: ReturnType<typeof useAsyncAction>;
  title: string;
  description: React.ReactNode;
  confirmPhrase: string;
  confirmLabel: string;
  pendingLabel: string;
  onConfirm: (typed: string) => boolean | undefined | Promise<boolean | undefined>;
  normalize?: (value: string) => string;
  close: () => void;
  children?: React.ReactNode;
}) {
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const { pending } = action;
  const normalizeValue = normalize ?? ((value: string) => value);
  const matches = normalizeValue(typed) === normalizeValue(confirmPhrase);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!matches || pending) return;
    const token = action.begin();
    if (token === null) return;
    try {
      const confirmed = await onConfirm(typed);
      if (!action.isCurrent(token)) return;
      action.finish(token);
      if (confirmed !== false) close();
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      // Contract: onConfirm handles its own failures and returns false. A
      // throw is a caller bug — stay open (like false) and report it.
      captureException(cause, { op: 'danger-confirm-dialog.confirm' });
      toast.error('Couldn’t complete that action. Try again.');
    } finally {
      action.finish(token);
    }
  }

  return (
    <Form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
      </ModalHeader>
      <ModalContent className="flex flex-col gap-4">
        <ModalDescription className="text-body text-muted-foreground">
          {description}
        </ModalDescription>
        {children}
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-body">
            Type <span className="font-semibold break-all">{confirmPhrase}</span> to confirm.
          </label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
          />
        </div>
      </ModalContent>
      <ModalFooter>
        <ModalClose asChild>
          <Button type="button" variant="ghost" disabled={pending}>
            Cancel
          </Button>
        </ModalClose>
        <Button type="submit" variant="destructive-solid" disabled={pending || !matches}>
          {pending ? <Spinner aria-hidden /> : null}
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </ModalFooter>
    </Form>
  );
}
