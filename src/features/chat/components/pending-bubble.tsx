'use client';
import { IconAlertCircle, IconRefreshCw02 } from '@/components/icons';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { stripAttachedFiles } from '@/features/sessions/lib/strip-attached-files';
import { MessageAttachments } from './message-attachments';
import { UserMessage } from './user-message';

// MessageScroller anchors fresh sends and holds position during live streaming.
// Follow the bottom only during initial replay and grace; history never creates anchors.
// Optimistic user messages render immediately, then reconcile on echo or show send failure.
export type PendingSend = {
  attachments?: OptimisticComposerAttachment[];
  localId: string;
  text: string;
  status: 'sending' | 'unconfirmed' | 'delivered' | 'error';
  errorMessage?: string;
};

export function PendingBubble({
  pending,
  onRetry,
}: {
  pending: PendingSend;
  onRetry?: (localId: string, text: string) => void;
}) {
  // Optimistic sends use the settled message layout to avoid shifting on echo.
  if (pending.status !== 'error') {
    return (
      <div className="duration-150 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
        <UserMessage text={pending.text} attachments={pending.attachments} />
      </div>
    );
  }

  // The failed send: the same bubble geometry with a destructive tint and an
  // inline retry — surfaced ON the bubble, never blocking the composer. The
  // <attached_files> block is stripped for display exactly as UserMessage does;
  // `pending.text` (the reconcile/retry payload) stays intact.
  const { text: visibleText, entries } = stripAttachedFiles(pending.text);
  return (
    <Message align="end">
      <MessageContent className="items-end gap-1">
        <MessageAttachments entries={entries} attachments={pending.attachments} />
        <Bubble variant="default" align="end" className="max-w-[80%]">
          <BubbleContent className="rounded-xl border border-destructive/40 bg-destructive/5! p-0 text-foreground!">
            <p className="whitespace-pre-wrap break-words px-4 py-2.5 text-body-lg">
              {visibleText || pending.text}
            </p>
          </BubbleContent>
        </Bubble>
        <div className="flex items-center gap-2 text-meta font-normal text-destructive">
          <IconAlertCircle className="size-3.5" />
          <span>{pending.errorMessage ?? 'Couldn’t send.'}</span>
          <button
            type="button"
            onClick={() => onRetry?.(pending.localId, pending.text)}
            className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:no-underline"
          >
            <IconRefreshCw02 className="size-3" />
            Retry
          </button>
        </div>
      </MessageContent>
    </Message>
  );
}
