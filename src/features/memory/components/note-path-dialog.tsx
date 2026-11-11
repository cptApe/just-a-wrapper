'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { isValidNotePath, normalizeNoteFolder } from '../lib/notes';

// Folders are implicit in a note path; editing the full path performs rename and move together.
export function NotePathDialog({
  open,
  title,
  initialPath,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialPath: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (path: string) => void;
}) {
  const [value, setValue] = React.useState(initialPath);
  const [openedFor, setOpenedFor] = React.useState(open);
  if (openedFor !== open) {
    setOpenedFor(open);
    setValue(initialPath);
  }

  const normalized = normalizePathInput(value);
  const valid = normalized !== null;

  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm">
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy && normalized !== initialPath) onSubmit(normalized);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="flex flex-col gap-1.5">
          <Label htmlFor="note-path">Path</Label>
          <Input
            id="note-path"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            autoComplete="off"
            aria-invalid={!valid}
            placeholder="/projects/launch-plan.md"
          />
          <p className="text-meta font-normal text-muted-foreground">
            Folders are part of the path. <span className="tabular">/facts/billing.md</span> lives
            in “Facts”.
          </p>
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
          <Button type="submit" size="sm" disabled={busy || !valid} aria-busy={busy}>
            Save
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

/** Normalize a typed path (add the leading slash, trim segments) or null. */
function normalizePathInput(input: string): string | null {
  const raw = input.trim();
  if (raw === '') return null;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  // normalizeNoteFolder handles segment trimming; re-validate as a NOTE path
  // (must have a filename, not be the root).
  const normalized = normalizeNoteFolder(withSlash);
  if (normalized === null || normalized === '/') return null;
  return isValidNotePath(normalized) ? normalized : null;
}
