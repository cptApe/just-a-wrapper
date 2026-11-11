'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { FLOATING_EDGE_GAP } from './lib/floating';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    { className, align = 'center', sideOffset = 8, collisionPadding = FLOATING_EDGE_GAP, ...props },
    ref,
  ) => (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          // Floating layer: popover + the one sanctioned soft shadow (a 1px
          // ring is baked into the token). Radius 16. Scale-fade
          // grows from the trigger side via Radix's transform-origin var.
          // z-dialog, not z-dropdown: popovers open from inside sheets/dialogs
          // (mobile sidebar), so they share the dialog layer and DOM order wins.
          'z-dialog w-72 rounded-lg bg-popover text-foreground p-4 shadow-popover outline-none',
          'origin-[var(--radix-popover-content-transform-origin)]',
          // animation-duration-*, never duration-*: duration-* also sets
          // transition-duration, which slides the transform origin from the
          // panel's centre to its anchor while the panel scales in.
          'animation-duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  ),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;
