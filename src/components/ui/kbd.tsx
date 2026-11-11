import type * as React from 'react';
import { cn } from '@/lib/utils';

// Keyboard hints use quiet borderless theme-token chips below label size.
// Tooltip-specific upstream selectors do not apply because our Tooltip does
// not stamp data-slot="tooltip-content".

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-4 w-fit min-w-4 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-meta font-medium text-muted-foreground',
        "[&_svg:not([class*='size-'])]:size-2.5",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
