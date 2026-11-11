'use client';

import { useState } from 'react';
import { IconCheck, IconCopy01, IconPaperclip } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/hooks/use-copy';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { stripAttachedFiles } from '@/features/sessions/lib/strip-attached-files';
import { formatCompactDate, formatDateTime } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import type { AuthorChip } from '../types';
import { MessageAttachments } from './message-attachments';

// User turns place attachment cards above a collapsible message bubble.
// Hover metadata shows timestamp and copy. Shared message primitives preserve
// the end-aligned layout; long text collapses at the threshold below.
const COLLAPSE_CHARS = 700;
const COLLAPSE_LINES = 12;

export function UserMessage({
  text,
  at,
  author,
  attachments,
}: {
  attachments?: OptimisticComposerAttachment[];
  text: string;
  at?: string;
  /** The teammate who wrote this turn on a shared task. */
  author?: AuthorChip;
}) {
  const { text: visible, entries, hadAttachments } = stripAttachedFiles(text);

  return (
    // `group` (unnamed) drives the meta row's hover reveal.
    <Message align="end" className="group">
      <MessageContent className="items-end gap-1.5">
        {author ? <MessageAuthorRow author={author} /> : null}
        <MessageAttachments entries={entries} attachments={attachments} />

        {visible ? (
          <CollapsibleBubble text={visible} />
        ) : entries.length === 0 && hadAttachments ? (
          <div className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-meta font-medium text-primary-foreground">
            <IconPaperclip className="size-3.5" />
            Shared files with the agent
          </div>
        ) : null}

        <MetaRow text={visible} at={at} />
      </MessageContent>
    </Message>
  );
}

// Member avatar and first name above the bubble. Creator turns carry no chip.
function MessageAuthorRow({ author }: { author: AuthorChip }) {
  return (
    <div className="flex items-center gap-1.5 pr-0.5" data-testid="message-author">
      <Avatar className="size-5">
        {author.image ? <AvatarImage src={author.image} alt="" /> : null}
        <AvatarFallback className="text-meta">{authorInitials(author.name)}</AvatarFallback>
      </Avatar>
      <span className="text-meta font-medium text-muted-foreground">{firstName(author.name)}</span>
    </div>
  );
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

function authorInitials(name: string): string {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

function CollapsibleBubble({ text }: { text: string }) {
  const lines = text.split('\n').length;
  const collapsible = text.length > COLLAPSE_CHARS || lines > COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  const collapsed = collapsible && !expanded;

  return (
    // `relative` anchors the collapse fade to the text so it cannot cover the toggle.
    <Bubble variant="default" align="end" className="items-end">
      <BubbleContent className="relative rounded-xl p-0">
        <p
          className={cn(
            'whitespace-pre-wrap break-words max-md:wrap-anywhere px-4 py-2.5 text-body-lg',
            collapsed && 'max-h-52 overflow-hidden',
          )}
        >
          {text}
        </p>
        {collapsed ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-bl-xl bg-gradient-to-t from-primary to-transparent" />
        ) : null}
      </BubbleContent>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="max-md:min-h-11 rounded-sm text-meta font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </Bubble>
  );
}

// Timestamp + copy, revealed on hover/focus so the thread stays calm at rest.
// An attachment-only turn has no words to copy, so it shows only the timestamp.
function MetaRow({ text, at }: { text: string; at?: string }) {
  const display = useDisplayFormat();
  const { copyState, announcement, copy } = useCopy({
    getText: () => text,
    op: 'copy-user-message',
    context: undefined,
    successToast: undefined,
    failureToast: 'Couldn’t copy the message.',
  });
  return (
    <MessageFooter className="gap-1 px-0 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
      {at ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* px-0.5 on the stamp itself so it doesn't crowd the copy button. */}
            <span className="cursor-default px-0.5 text-meta font-medium text-muted-foreground">
              {formatCompactDate(at, display)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{formatDateTime(at, display)}</TooltipContent>
        </Tooltip>
      ) : null}
      {text ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copy}
          aria-label="Copy message"
          className="text-muted-foreground max-md:size-11"
        >
          {copyState === 'copied' ? (
            <IconCheck className="size-3.5" />
          ) : (
            <IconCopy01 className="size-3.5" />
          )}
        </Button>
      ) : null}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </MessageFooter>
  );
}
