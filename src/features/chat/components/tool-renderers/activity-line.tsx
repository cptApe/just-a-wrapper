'use client';

import type { ReactNode } from 'react';
import { IconChevronRight } from '@/components/icons';
import { ShimmerText } from '@/components/ui/shimmer-text';
import { cn } from '@/lib/utils';
import type { ToolStatus } from '../../lib/tool-display-activity';

// The one line every tool call is: a small leading glyph, a quiet human
// sentence at body size, and nothing else. No border, no background, no
// status column. The state is in the words (tool-display-activity); the only
// chrome is a shimmer while the call runs, a small inline badge for the two
// states a user must not miss, and a chevron that appears on hover when there
// is something to unfold. The details unfold DIRECTLY below, on the same left
// edge as the text, never in an indented box.

type ActivityLineProps = {
  /** The leading glyph, sized by the caller (a 16px icon or favicon). */
  icon: ReactNode;
  text: string;
  status: ToolStatus;
  /** "Denied" / "Turned off", inline right after the phrase. */
  badge?: string | null;
  /** Present when the line can unfold details. */
  expanded?: boolean;
  onToggle?: () => void;
  /** An optional small control after the phrase (the browser's "View"). */
  trailing?: ReactNode;
  /** The unfolded details, rendered under the line on the text's left edge. */
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
};

/** The one red mark on an activity line: a small destructive pill with white text,
 *  inline right after the phrase, for the states where a person or a setting
 *  stopped the call (Denied, Turned off). A plain failure never gets one: the
 *  agent tried something, the phrase says so, and a red mark would read as
 *  the product being broken. */
// A saturated true red (--destructive-strong, the same in both themes) with a
// word that stays white on purpose; --destructive-foreground flips with the
// theme and reads dark on a red fill in dark mode, so no theme token can stand
// in for the white.
const PILL_CLASS =
  'ml-1.5 inline-flex translate-y-[-2px] items-center rounded-full bg-destructive-strong px-2 py-px align-middle text-meta font-medium text-on-media';

function StatusPill({
  children,
  'data-testid': testId,
}: {
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <span className={PILL_CLASS} data-testid={testId}>
      {children}
    </span>
  );
}

/** Left inset of everything that hangs under the line: glyph + gap. */
const LINE_INSET_CLASS = 'pl-6';

export function ActivityLine({
  icon,
  text,
  status,
  badge = null,
  expanded = false,
  onToggle,
  trailing,
  children,
  className,
  'data-testid': testId,
}: ActivityLineProps) {
  const running = status === 'running';
  const content = (
    <>
      <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 break-words max-md:wrap-anywhere text-body-lg">
        <ShimmerText active={running}>{text}</ShimmerText>
        {badge ? <StatusPill data-testid="tool-badge">{badge}</StatusPill> : null}
      </span>
    </>
  );

  return (
    <div className={cn('flex min-w-0 flex-col', className)} data-testid={testId}>
      <div className="group/line flex min-w-0 items-center gap-2 text-muted-foreground">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-h-11 min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
            <IconChevronRight
              aria-hidden
              className={cn(
                'size-3.5 shrink-0 transition-[transform,opacity] duration-150 motion-reduce:transition-none',
                // Hover-capable devices reveal the chevron on hover or focus, or
                // once open; touch devices keep it visible so it stays reachable.
                '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/line:opacity-100 [@media(hover:hover)]:group-focus-within/line:opacity-100',
                expanded && 'rotate-90 [@media(hover:hover)]:opacity-100',
              )}
            />
          </button>
        ) : (
          <div className="flex min-h-11 min-w-0 items-center gap-2">{content}</div>
        )}
        {trailing ? (
          <span className="flex min-h-11 shrink-0 items-center [&_button]:min-h-11">
            {trailing}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** What hangs under a line: previews, decisions, unfolded details. Same left
 *  edge as the line's words. */
export function LineBody({
  children,
  className,
  'data-testid': testId,
}: {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-2 pt-1.5', LINE_INSET_CLASS, className)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
