'use client';

import { IconClock } from '@/components/icons';
import { plural } from '@/lib/format/plural';
import { cn } from '@/lib/utils';
import { composerChatColumnClass } from '../lib/composer-geometry';

// The queued-message stack: user messages sent while the agent is mid-turn
// stack here, directly above the composer in its column, until the agent
// reaches them — then they render in the thread at their natural stream
// position. Pure PRESENTATION over already-sent data: a mid-run send POSTs
// immediately (native platform behavior — it absorbs mid-run messages at the
// earliest opportunity); chat-view diverts the unprocessed trailing echoes
// (and the optimistic pendings racing them) to this stack instead of the
// thread. Recessed on purpose — whisper fill, muted text — so the live
// composer stays primary; status only, no manage affordances. The one
// interactive state is a send whose POST failed: that message truly is
// unsent, so its card says so and offers Retry. Top card is oldest; the
// newest sits at the bottom, nearest the composer.

export type QueuedCardItem = {
  /** Stream event id for an echoed message; the local send id before echo. */
  id: string;
  /** Display text — attachment markup already stripped by the caller. */
  text: string;
  /** Attached-file references riding the message, for the count label. */
  fileCount: number;
  /** 'queued' = sent, waiting for the agent; 'error' = the POST failed. */
  status: 'queued' | 'error';
};

export function ComposerQueue({
  items,
  onRetry,
}: {
  items: QueuedCardItem[];
  /** Retry a card whose POST failed (only 'error' cards render the control). */
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="shrink-0 px-4" data-testid="composer-queue-stack">
      <ul className={`${composerChatColumnClass} flex flex-col gap-1.5`}>
        {items.map((item) => (
          <li
            key={item.id}
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3.5 py-2',
              item.status === 'error'
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-alpha-8 bg-alpha-3',
            )}
            data-testid="composer-queue-item"
          >
            <IconClock
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                item.status === 'error' ? 'text-destructive' : 'text-foreground-tertiary',
              )}
            />
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-meta text-muted-foreground">
              {item.text}
            </p>
            {item.status === 'error' ? (
              <span className="flex shrink-0 items-center gap-2 pt-px text-meta font-medium">
                <span className="text-destructive">Couldn’t send</span>
                <button
                  type="button"
                  onClick={() => onRetry(item.id)}
                  className="font-medium text-foreground underline underline-offset-2 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry
                </button>
              </span>
            ) : (
              <span className="shrink-0 pt-px text-meta font-medium text-foreground-tertiary">
                {item.fileCount > 0 ? `Queued · ${plural(item.fileCount, 'file')}` : 'Queued'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
