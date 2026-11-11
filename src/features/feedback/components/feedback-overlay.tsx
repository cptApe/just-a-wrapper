'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
// Type-only import — erased at compile time, so the registry→overlay→registry
// module loop never exists at runtime.
import type { OverlayComponentProps } from '@/features/overlays';
import { useOverlayCloseGuard } from '@/features/overlays/hooks/use-overlay-close-guard';
import { useAsyncAction } from '@/hooks/use-async-action';
import { captureException } from '@/lib/observability-client';
import { submitAppFeedback } from '../api/submit-app-feedback';
import { MAX_FEEDBACK_LENGTH } from '../types';

// The feedback overlay works over any app page and reads its own pathname.
// submitAppFeedback stores the route. Keep pending explicit; success closes the overlay.

export function FeedbackOverlay({ open, onClose }: OverlayComponentProps) {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const action = useAsyncAction();
  const releaseCloseGuard = useOverlayCloseGuard(action.pending);

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && !action.pending;

  async function submit() {
    if (!canSend) return;
    const token = action.begin();
    if (token === null) return;
    try {
      const submission = await submitAppFeedback({ body: message, route: pathname });
      if (!action.isCurrent(token)) return;
      if (submission.ok) {
        action.finish(token);
        releaseCloseGuard();
        onClose();
        toast.success('Thanks, feedback sent.');
        return;
      }
      toast.error('Couldn’t send your feedback. Try again.', {
        description: submission.message,
      });
      action.finish(token);
    } catch (cause) {
      if (!action.isCurrent(token)) return;
      // A server action can reject before returning a typed result (network
      // drop, serialization). Surface it through the house toast.
      captureException(cause, { op: 'feedback.submit' });
      toast.error('Couldn’t send your feedback. Try again.');
      action.finish(token);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !action.pending) onClose();
      }}
      presentation="dialog"
      size="sm"
    >
      <ModalHeader>
        <ModalTitle>Leave feedback</ModalTitle>
      </ModalHeader>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <ModalContent className="gap-3">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What's working? What's broken? What's missing?"
            aria-label="Your feedback"
            maxLength={MAX_FEEDBACK_LENGTH}
            rows={7}
            // The textarea is the modal's sole purpose, so focus belongs here.
            autoFocus
          />
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="secondary" disabled={action.pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSend}>
            {action.pending ? 'Sending…' : 'Send feedback'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
