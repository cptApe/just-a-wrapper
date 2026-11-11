'use client';

import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      'relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 max-sm:after:min-h-11 max-sm:after:min-w-11 max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2 peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
      // Track color crossfades on the same clock as the thumb travel so the
      // flip reads as one gesture, not two.
      'transition-colors duration-[250ms] ease-[var(--ease-out)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      'disabled:cursor-not-allowed disabled:opacity-50',
      'data-[state=unchecked]:bg-alpha-16',
      'data-[state=checked]:bg-switch-checked',
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block size-4 rounded-full bg-background shadow-sm',
        // A back-out curve overshoots the endpoint ~5% and settles. The global
        // reduced-motion floor collapses this to a snap.
        'transition-transform duration-[250ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
        'data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0.5',
        'data-[state=checked]:bg-switch-foreground',
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = 'Switch';
