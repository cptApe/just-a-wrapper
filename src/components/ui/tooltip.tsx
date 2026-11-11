'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { FLOATING_EDGE_GAP } from './lib/floating';
import { tooltipReducer } from './lib/hint-machine';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, collisionPadding = FLOATING_EDGE_GAP, ...props }, ref) => (
  // Portal to the body so the tip escapes any clipping/overflow ancestor (e.g. a
  // DropdownMenu/Select content panel): a `side` tooltip on a menu item must sit
  // in the top layer next to the menu, not get cropped at its edge. z-dialog
  // keeps it above dialogs (portaled too; later DOM sibling + equal z wins).
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      className={cn(
        // Small dark pill, no arrow.
        'z-dialog rounded-button bg-foreground text-background px-2.5 py-1 text-meta font-medium leading-none',
        'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
        'data-[state=delayed-open]:fade-in-0 data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/** Tooltips inside autofocus overlays open only for hover or keyboard focus
 * after mount settles. Ignoring programmatic autofocus prevents a stuck label
 * when a dialog opens; real Tab and pointer interaction still show the tip. */
export function HoverFocusTooltip({
  content,
  side = 'bottom',
  children,
}: {
  content: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  /** The trigger, rendered `asChild`. */
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(tooltipReducer, { kind: 'unarmed' });
  const open = state.kind === 'open';
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => dispatch('arm'));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        // We own opening; honor only Radix's close requests (Escape, outside
        // pointer down) so dismissal still works.
        if (!next) dispatch('close');
      }}
    >
      <TooltipTrigger
        asChild
        // Guard the pointer path with the same mount gate as focus: an element
        // that mounts under a stationary cursor can get a synthetic pointerenter,
        // which would pop the tip at open just like the autofocus does.
        onPointerEnter={() => {
          dispatch('open');
        }}
        onPointerLeave={() => dispatch('close')}
        onFocus={(e) => {
          // Keyboard focus only: a mouse click focuses the button too, but
          // :focus-visible stays false for it, and the mount guard drops the
          // programmatic autofocus regardless of how the dialog was opened.
          if (e.currentTarget.matches(':focus-visible')) dispatch('open');
        }}
        onBlur={() => dispatch('close')}
      >
        {children}
      </TooltipTrigger>
      {/* Controlled opens report data-state="instant-open"; animate that too so
          the tip still fades in when it opens. */}
      <TooltipContent
        side={side}
        className="data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * A tooltip that opens only after the pointer (or keyboard focus) DWELLS on the
 * trigger for `delay` ms, and never on Radix's instant paths.
 *
 * Why this exists: inside a DropdownMenu/Select, roving focus moves DOM focus to
 * an item as the pointer hovers it, and Radix Tooltip opens IMMEDIATELY on focus
 * — bypassing `delayDuration`. So a plain `Tooltip` on a menu item pops the tip
 * the instant you brush past it. Here `open` is controlled: we drive opening
 * ourselves off a pointer-enter / focus timer (quick pass-throughs never fire
 * it) and only honor Radix's CLOSE requests (pointer leave, blur, Escape) so the
 * tip can never get stuck open. Keyboard uses the SAME delay on focus — arrow
 * keys stepping through options don't flash the tip, matching the pointer feel.
 *
 * Keeps the portal/side behavior of TooltipContent unchanged.
 */
export function DelayedTooltip({
  content,
  side = 'right',
  delay = 500,
  children,
}: {
  content: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
  /** Dwell before the tip opens, ms. */
  delay?: number;
  /** The trigger, rendered `asChild` (e.g. a menu/select item). */
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(tooltipReducer, { kind: 'closed' });
  const open = state.kind === 'open';
  React.useEffect(() => {
    if (state.kind !== 'pending') return;
    const timer = setTimeout(() => dispatch('open'), delay);
    return () => clearTimeout(timer);
  }, [state.kind, delay]);
  const openAfterDelay = () => dispatch('wait');
  const closeNow = () => dispatch('close');

  return (
    <Tooltip
      open={open}
      // We own opening (delayed); honor only Radix's close requests so Escape /
      // dismissal still work. Ignoring the open request is what defeats the
      // instant-on-focus behavior.
      onOpenChange={(next) => {
        if (!next) closeNow();
      }}
    >
      <TooltipTrigger
        asChild
        onPointerEnter={openAfterDelay}
        onPointerLeave={closeNow}
        onFocus={openAfterDelay}
        onBlur={closeNow}
      >
        {children}
      </TooltipTrigger>
      {/* Controlled opens report data-state="instant-open"; animate that too so
          the tip still fades in when the dwell timer fires. */}
      <TooltipContent
        side={side}
        className="data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
