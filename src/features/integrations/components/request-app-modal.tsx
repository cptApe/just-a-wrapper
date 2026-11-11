'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { captureException } from '@/lib/observability-client';
import { submitAppRequest } from '../api/tool-requests';

// Form for requesting a missing app.

export function RequestAppModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    if (sending || message.trim() === '') return;
    setSending(true);
    try {
      await submitAppRequest({ message: message.trim() });
      toast.success('Request received. Thanks.');
      setMessage('');
      onOpenChange(false);
    } catch (error) {
      captureException(error, { op: 'request-app' });
      toast.error('That didn’t send. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(next) => !next && !sending && onOpenChange(false)} size="sm">
      <ModalHeader>
        <ModalTitle>Request an app</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="e.g. HubSpot, so my agent can update deals after client calls"
            className="min-h-[100px]"
            maxLength={2000}
            aria-label="App request"
          />
        </ModalContent>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={sending || message.trim() === ''}>
            {sending ? 'Sending…' : 'Send request'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
