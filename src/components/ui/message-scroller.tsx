'use client';

import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
} from '@shadcn/react/message-scroller';
import * as React from 'react';

import { IconArrowDown } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      // `scroll-fade` (our vertical both-edge shadcn util, globals.css) masks the
      // top + bottom edges so content dissolves into the header/footer. Replaces
      // the registry's single-edge `scroll-fade-b` and the scrollbar-* plugin
      // utilities this project styles natively (globals.css ::-webkit-scrollbar).
      className={cn(
        'scroll-fade size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-8', className)}
      {...props}
    />
  );
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      // The registry ships `content-visibility:auto` with a fixed 10rem intrinsic
      // size for offscreen perf. Our turns are variable-height (and paginated), so
      // that estimate is always wrong and makes the layout above a pinned turn
      // shift as items scroll in — drifting the pin. Correctness over the micro-
      // perf: render items normally.
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  );
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  behavior,
  variant = 'secondary',
  size = 'icon-sm',
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button> &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  // The primitive scrolls with behavior:"smooth" by default; honor the OS
  // reduce-motion setting by jumping instantly instead (spec: no scroll
  // animation when the user asked for less motion).
  const reduceMotion = usePrefersReducedMotion();
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      data-variant={variant}
      data-size={size}
      direction={direction}
      behavior={behavior ?? (reduceMotion ? 'auto' : 'smooth')}
      // Single accessible name: the caller's aria-label, else a direction default.
      // (No sr-only child — it would double up with the aria-label.)
      aria-label={ariaLabel ?? (direction === 'end' ? 'Scroll to end' : 'Scroll to start')}
      className={cn(
        'absolute inset-s-1/2 -translate-x-1/2 transition-[translate,scale,opacity] duration-200 data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180',
        className,
      )}
      render={render ?? <Button variant={variant} size={size} />}
      {...props}
    >
      {children ?? <IconArrowDown />}
    </MessageScrollerPrimitive.Button>
  );
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
};
