'use client';

import { DelayedTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { composerChatColumnClass } from '../lib/composer-geometry';

// The quiet meta line under the Task composer, living inside the composer's
// bottom clearance zone (composerBottomSafeAreaClass): the mistakes disclaimer
// on the left, the task's agent mode on the right — plain info, not a control,
// since the platform fixes a session's model at create. Rendered by BOTH the
// live chat view and ChatLoadingFrame so the composer settles with no vertical
// shift; the frame just doesn't know the plan yet (label pops in on load,
// height never moves — the disclaimer holds the line). The inner px-5 is
// composerCardInnerClass's px-4 plus the textarea's own p-1, so the row's text
// starts exactly where the input text starts — not at the card's rounded-sm edge.
export function ComposerMetaRow({ plan }: { plan?: string }) {
  return (
    <div className="px-4">
      <div
        className={cn(composerChatColumnClass, 'flex items-center justify-between gap-3 px-5 pt-1')}
      >
        <span className="min-w-0 truncate text-meta font-normal text-foreground-tertiary">
          Agent can make mistakes.
          {/* Phones keep the short form so the line never truncates beside Mode. */}
          <span className="max-sm:hidden"> Check important info.</span>
        </span>
        {plan ? (
          <DelayedTooltip side="top" content="Mode is set when the task starts.">
            <span
              className="shrink-0 text-meta font-normal text-foreground-tertiary"
              data-testid="task-plan"
            >
              Mode: {plan}
            </span>
          </DelayedTooltip>
        ) : (
          <span aria-hidden className="shrink-0" />
        )}
      </div>
    </div>
  );
}
