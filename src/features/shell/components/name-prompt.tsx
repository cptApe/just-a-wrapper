'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { authClient } from '@/lib/auth-client';
import { captureException } from '@/lib/observability-client';

const MAX_NAME_LENGTH = 100;

// Email sign-up creates an account with no name, and every shared surface needs one.
export function NamePrompt() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [open, setOpen] = useState(true);
  const trimmed = name.trim();

  async function save() {
    setOpen(false);
    try {
      const { error } = await authClient.updateUser({ name: trimmed });
      if (error) throw error;
      router.refresh();
    } catch (cause) {
      captureException(cause, { op: 'shell.name-prompt' });
      setOpen(true);
      toast.error('Couldn’t save your name. Try again.');
    }
  }

  return (
    <Modal open={open} closable={false} size="sm">
      <ModalHeader>
        <ModalTitle>What’s your name?</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed !== '') void save();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Your name"
            autoComplete="name"
            maxLength={MAX_NAME_LENGTH}
            autoFocus
          />
        </ModalContent>
        <ModalFooter>
          <Button type="submit" disabled={trimmed === ''}>
            Continue
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
