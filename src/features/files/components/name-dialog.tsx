'use client';

import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';

// Collects a folder name; the caller owns the action and its result.
export function NameDialog({
  open,
  title,
  label,
  submitLabel,
  busy,
  onSubmit,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  label: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm">
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const value = String(data.get('folder-name') ?? '').trim();
          if (value.length > 0 && !busy) onSubmit(value);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder-name">{label}</Label>
            <Input
              id="folder-name"
              name="folder-name"
              placeholder="e.g. Reports"
              autoFocus
              autoComplete="off"
            />
          </div>
        </ModalContent>
        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
            {submitLabel}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
