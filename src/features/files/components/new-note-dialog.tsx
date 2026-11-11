'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';

// Collect a note name and markdown body; the caller chooses drive or memory storage.

export function NewNoteDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, content: string) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="sm">
      <ModalHeader>
        <ModalTitle>New note</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const name = String(data.get('note-name') ?? '').trim();
          const content = String(data.get('note-content') ?? '');
          if (name.length > 0 && !busy) onSubmit(name, content);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-name">Note name</Label>
            <Input
              id="note-name"
              name="note-name"
              placeholder="e.g. Meeting notes"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note-content">Content</Label>
            <Textarea
              id="note-content"
              name="note-content"
              rows={8}
              placeholder="Write in plain text or markdown…"
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
            Create
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
