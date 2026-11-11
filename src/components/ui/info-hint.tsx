'use client';

import * as React from 'react';
import { IconInfoCircle } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { hintReducer } from './lib/hint-machine';

// Shared inline explainer: Tooltip for one sentence, Popover for a learn-more link.
// Both open on hover; the Popover also pins on click so its link is reachable.

const HOVER_CLOSE_DELAY_MS = 150;

function HintTrigger({
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 max-sm:after:min-h-11 max-sm:after:min-w-11 max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2 inline-flex size-5 shrink-0 items-center justify-center rounded-button align-middle',
        'text-foreground-tertiary transition-colors duration-150 ease-[var(--ease-out)]',
        'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        className,
      )}
      {...props}
    >
      <IconInfoCircle className="size-3.5" />
    </button>
  );
}

function HoverPopoverHint({
  label,
  learnMoreHref,
  className,
  children,
}: {
  label: string;
  learnMoreHref: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(hintReducer, { kind: 'closed' });
  const closeTimer = React.useRef<number | null>(null);

  const open = state.kind !== 'closed';

  const enter = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    dispatch('enter');
  };
  // Small grace period so the pointer can travel trigger → content without
  // the popover collapsing under it.
  const leave = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => dispatch('leave'), HOVER_CLOSE_DELAY_MS);
  };
  React.useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Outside-click / ESC land here as `false`: fully close.
        dispatch(next ? 'pin' : 'close');
      }}
    >
      <PopoverTrigger asChild>
        <HintTrigger
          label={label}
          className={className}
          onMouseEnter={enter}
          onMouseLeave={leave}
          // preventDefault stops Radix's own click-toggle (it skips
          // default-prevented events), so a click while hover-open PINS
          // instead of closing.
          onClick={(e) => {
            e.preventDefault();
            dispatch('toggle');
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-3.5"
        onMouseEnter={enter}
        onMouseLeave={leave}
        // Hover-open must never steal keyboard focus from what the user is doing.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-2">
          <div className="text-meta text-foreground">{children}</div>
          <a
            href={learnMoreHref}
            target="_blank"
            rel="noreferrer"
            className="text-meta font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
          >
            Learn more
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InfoHint({
  label = 'More info',
  learnMoreHref,
  className,
  children,
}: {
  /** Accessible name for the ⓘ button. */
  label?: string;
  /** Switches to the richer Popover form with a "Learn more" link. */
  learnMoreHref?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [tooltipOpen, setTooltipOpen] = React.useState(false);

  if (learnMoreHref) {
    return (
      <HoverPopoverHint label={label} learnMoreHref={learnMoreHref} className={className}>
        {children}
      </HoverPopoverHint>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <HintTrigger
            label={label}
            className={className}
            onClick={(event) => {
              if (!window.matchMedia('(pointer: coarse)').matches) return;
              event.preventDefault();
              setTooltipOpen((current) => !current);
            }}
          />
        </TooltipTrigger>
        {/* Hints can wrap to two lines — step the pill down to rounded-lg so the
            shape stays a card, not a stadium. */}
        <TooltipContent className="max-w-[260px] whitespace-normal rounded-lg px-3 py-1.5 leading-snug">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
