'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  IconCheck,
  IconCopy01,
  IconStopCircle,
  IconThumbsDown,
  IconThumbsDownSolid,
  IconThumbsUp,
  IconThumbsUpSolid,
  IconVolumeMax,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { useCopy } from '@/components/ui/hooks/use-copy';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MAX_TTS_CHARS } from '@/features/voice';
import { useMediaEnabled } from '@/features/voice/browser';
import { useAsyncAction } from '@/hooks/use-async-action';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';
import { chatQueryKeys } from '../api/keys';
import { useMessageFeedback } from '../hooks/use-message-feedback';
import { useReadAloud } from '../hooks/use-read-aloud';

// Assistant actions copy, read aloud and rate; timestamps belong to user turns.
// Feedback updates context without starting a turn.
// Touch-only hit-area expansion reaches 44px vertically while staying inside
// horizontal gaps so adjacent buttons cannot steal taps.
const TOUCH_TARGET =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-px pointer-coarse:after:-inset-y-1 pointer-coarse:after:content-['']";

const TOO_LONG_TO_READ = 'Too long to read aloud';

type Rating = 'up' | 'down';
// A resolved rating decision — what the agent was last told. Two decisions are
// the same iff both fields match, which is how we suppress a redundant re-feed.
type Decision = { rating: Rating; comment: string };

export function MessageActions({
  sessionId,
  eventId,
  text,
  canRate,
}: {
  sessionId: string;
  /** The reply's last Anthropic event id — keys feedback rows. */
  eventId: string;
  /** The whole reply: every text block of the turn, in order. */
  text: string;
  /** Ratings reach the agent, so only the task owner sees the thumbs. */
  canRate: boolean;
}) {
  const mediaEnabled = useMediaEnabled();
  const { copyState, copy } = useCopy({
    getText: () => text,
    op: 'copy-assistant-message',
    context: { sessionId },
    successToast: undefined,
    failureToast: 'Couldn’t copy the message.',
  });
  const {
    state: readAloud,
    start: startReadAloud,
    stop: stopReadAloud,
  } = useReadAloud(sessionId, text);
  const queryClient = useQueryClient();
  const feedbackKey = chatQueryKeys.feedback(sessionId);
  const feedback = useMessageFeedback(sessionId, false);
  const rated = feedback.data?.[eventId]?.rating ?? null;
  const [commentFor, setCommentFor] = useState<Rating | null>(null);
  // The speech route refuses longer text, so the button says so before the click.
  const tooLongToRead = text.length > MAX_TTS_CHARS;
  const readAloudBlocked = !mediaEnabled || tooLongToRead;

  // Both thumbs open the optional-comment modal. This is intentionally local
  // only: persistence and the solid visual state belong to explicit Send.
  function rate(direction: Rating) {
    setCommentFor(direction);
  }

  return (
    <div className="flex items-center gap-0.5 pt-1 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={copy}
            aria-label="Copy response"
            // The ghost variant paints text-foreground; force the resting row to
            // muted so both action rows share one muted style, matching the
            // user-turn meta row. Ghost hover shifts only the background.
            className={cn('text-muted-foreground', TOUCH_TARGET)}
          >
            {copyState === 'copied' ? (
              <IconCheck className="size-4" />
            ) : (
              <IconCopy01 className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Copy</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              if (!mediaEnabled) toast.error(CAPABILITY_OFF_MESSAGES.voice);
              else if (tooLongToRead) toast.error(TOO_LONG_TO_READ);
              else if (readAloud === 'idle') void startReadAloud();
              else stopReadAloud();
            }}
            aria-label={readAloud === 'idle' ? 'Read aloud' : 'Stop reading'}
            aria-disabled={readAloudBlocked}
            data-testid="read-aloud"
            className={cn('text-muted-foreground', TOUCH_TARGET, readAloudBlocked && 'opacity-50')}
          >
            {readAloud === 'loading' ? (
              <Spinner aria-hidden />
            ) : readAloud === 'playing' ? (
              <IconStopCircle className="size-4" />
            ) : (
              <IconVolumeMax className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {!mediaEnabled
            ? CAPABILITY_OFF_MESSAGES.voice
            : tooLongToRead
              ? TOO_LONG_TO_READ
              : readAloud === 'idle'
                ? 'Read aloud'
                : 'Stop'}
        </TooltipContent>
      </Tooltip>

      {canRate ? (
        <>
          <RatingButton
            disabled={feedback.isPending || feedback.isError}
            direction="up"
            rated={rated}
            onClick={() => rate('up')}
          />
          <RatingButton
            disabled={feedback.isPending || feedback.isError}
            direction="down"
            rated={rated}
            onClick={() => rate('down')}
          />
          {feedback.isError ? (
            <Button type="button" variant="link" size="xs" onClick={() => void feedback.refetch()}>
              Couldn’t load feedback. Retry
            </Button>
          ) : null}
        </>
      ) : null}
      {commentFor !== null ? (
        <FeedbackCommentModal
          key={commentFor}
          sessionId={sessionId}
          eventId={eventId}
          rating={commentFor}
          initialComment={feedback.data?.[eventId]?.comment ?? ''}
          lastFed={feedback.data?.[eventId] ?? null}
          onSubmit={(decision) => {
            queryClient.setQueryData<typeof feedback.data>(feedbackKey, (current) => ({
              ...current,
              [eventId]: decision,
            }));
          }}
          onClose={() => setCommentFor(null)}
        />
      ) : null}
    </div>
  );
}

const feedbackResponseSchema = z.object({ delivered: z.boolean() });

// The single home for the feedback POST. It is called only by the modal's
// explicit Send action. The route persists the decision and feeds the agent,
// and says whether the note reached the agent.
async function postFeedback(
  sessionId: string,
  eventId: string,
  rating: Rating,
  { comment }: { comment?: string } = {},
): Promise<{ delivered: boolean }> {
  return feedbackResponseSchema.parse(
    await fetchJson(`/api/sessions/${sessionId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId, rating, final: true, comment }),
    }),
  );
}

function RatingButton({
  direction,
  disabled,
  rated,
  onClick,
}: {
  direction: Rating;
  disabled: boolean;
  rated: Rating | null;
  onClick: () => void;
}) {
  const active = rated === direction;
  const Icon = direction === 'up' ? IconThumbsUp : IconThumbsDown;
  const IconActive = direction === 'up' ? IconThumbsUpSolid : IconThumbsDownSolid;
  const label = direction === 'up' ? 'Good response' : 'Not a good response';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keep actions muted at rest; a selected thumb uses a solid foreground glyph.
          className={cn(active ? 'text-foreground' : 'text-muted-foreground', TOUCH_TARGET)}
          data-testid={`feedback-${direction}`}
          onClick={onClick}
        >
          {active ? <IconActive className="size-4" /> : <Icon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

// The modal owns the whole rating decision: Send persists it, while Cancel,
// Escape, backdrop dismissal, and the close button only close. Reopening a
// submitted rating prefills its note; submitting an unchanged decision closes
// without a redundant feed.
function FeedbackCommentModal({
  sessionId,
  eventId,
  rating,
  initialComment,
  lastFed,
  onSubmit,
  onClose,
}: {
  sessionId: string;
  eventId: string;
  /** Which thumb's comment box is open. */
  rating: Rating;
  /** The stored note for this message — prefills the box. */
  initialComment: string;
  /** The decision last fed to the agent for this message; null if none yet. */
  lastFed: Decision | null;
  /** Called after a decision is submitted, so the parent can show it. */
  onSubmit: (decision: Decision) => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState(initialComment);
  const request = useAsyncAction();
  const state = request.pending ? 'submitting' : 'idle';

  // Has this decision already been fed? Reopening a rated thumb and closing it
  // unchanged must not re-feed the agent nor rewrite the row.
  function alreadyFed(decision: Decision): boolean {
    return (
      lastFed !== null && lastFed.rating === decision.rating && lastFed.comment === decision.comment
    );
  }

  // Dismissal is a true no-op: no persistence and no visual-state change.
  function dismiss() {
    if (request.pending) return;
    onClose();
  }

  // Send persists the rating with an optional note. It blocks so a failed post
  // keeps the modal open and the note is not lost.
  async function send() {
    if (state === 'submitting') return;
    const note = comment.trim();
    const decision: Decision = { rating, comment: note };
    // Identical to the last fed decision (e.g. Send without editing the prefill)
    // — nothing to persist or feed. Claim the guard and close.
    if (alreadyFed(decision)) {
      onClose();
      return;
    }
    await request.run(async () => {
      try {
        const { delivered } = await postFeedback(sessionId, eventId, rating, { comment: note });
        onSubmit(decision);
        onClose();
        toast.success(
          delivered ? 'Thanks. The agent will take it on board.' : 'Thanks for the feedback.',
        );
      } catch (error) {
        captureException(error, { op: 'chat.feedback-comment', sessionId });
        toast.error('Couldn’t send your note. Try again.');
      }
    });
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
      presentation="dialog"
      size="sm"
    >
      <ModalHeader>
        <ModalTitle>{rating === 'down' ? 'What went wrong?' : 'What worked well?'}</ModalTitle>
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
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
            aria-label="Feedback details"
            className="text-body"
            // This modal exists only to type the feedback note, so focus belongs here.
            autoFocus
          />
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="secondary" onClick={dismiss}>
            Cancel
          </Button>
          <Button type="submit" disabled={state === 'submitting'}>
            {state === 'submitting' ? 'Sending…' : 'Send'}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
}
