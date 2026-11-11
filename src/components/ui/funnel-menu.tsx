'use client';

import * as React from 'react';
import { IconFilterFunnel01 } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// One shared funnel menu combines sorting and filtering.
// Pages supply their sort and facet sections inside the standard trigger shell.

export function FunnelMenu({
  active,
  label = 'Filter',
  children,
}: {
  /** A facet is active — the trigger shows a dot so filtered views read as such. */
  active?: boolean;
  /** Accessible name for the trigger. */
  label?: string;
  /** Menu sections (DropdownMenu* elements): facets. */
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${label}, filter applied` : label}
          className={cn(
            'relative inline-flex size-9 items-center justify-center rounded-button text-muted-foreground',
            'transition-colors duration-150 ease-[var(--ease-out)]',
            'hover:bg-alpha-6 hover:text-foreground',
            'data-[state=open]:bg-alpha-6 data-[state=open]:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          )}
        >
          <IconFilterFunnel01 className="size-4" />
          {active ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-foreground"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
