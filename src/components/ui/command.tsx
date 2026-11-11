'use client';

import { Command as CommandPrimitive } from 'cmdk';
import * as React from 'react';
import { IconSearchMd, IconXClose } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

// cmdk primitives on the design system's tokens: rows
// radius 10, alpha-6 selection fill, 16px input so iOS never zooms. Overlays are
// the Modal family (09-modals), so the command menu composes `Command` inside `Modal`.

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex h-full w-full flex-col overflow-hidden text-foreground', className)}
      {...props}
    />
  );
}

function CommandInput({
  className,
  loading,
  onClear,
  wrapperClassName,
  clearLabel,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** While true the leading search glyph swaps in place for the spinner (same
      size/position → no layout shift). The one loading indicator; there is no
      separate trailing spinner (no double indicators). */
  loading?: boolean;
  /** When provided, a trailing clear button shows whenever the input has text;
      clicking it clears the value and refocuses the input. */
  onClear?: () => void;
  /** Extra classes on the input row (e.g. clearance for a floating close pill). */
  wrapperClassName?: string;
  clearLabel?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const value = typeof props.value === 'string' ? props.value : '';
  const showClear = onClear != null && value.length > 0;
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn(
        'flex h-14 shrink-0 items-center gap-3 border-b border-border px-5',
        wrapperClassName,
      )}
    >
      {loading ? (
        // No aria-hidden: Spinner carries role="status" + aria-label="Loading",
        // so an in-flight search stays announced to screen readers.
        <Spinner className="size-5 shrink-0 text-muted-foreground" />
      ) : (
        <IconSearchMd aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      )}
      <CommandPrimitive.Input
        ref={inputRef}
        data-slot="command-input"
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-body-lg text-foreground outline-none',
          'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      {showClear ? (
        <Button
          variant="ghost"
          size={clearLabel ? 'sm' : 'icon-xs'}
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onClear();
            inputRef.current?.focus();
          }}
          className={cn(
            'shrink-0',
            !clearLabel && 'size-6 p-0',
            'text-muted-foreground transition-colors',
            'hover:bg-alpha-6 hover:text-foreground',
          )}
        >
          {clearLabel ?? <IconXClose aria-hidden className="size-4" />}
        </Button>
      ) : null}
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'flex-1 scroll-py-2 overflow-y-auto overflow-x-hidden overscroll-contain',
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'overflow-hidden px-3 pb-1 pt-2',
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-1',
        '[&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-md px-3 py-2 text-body outline-none',
        'data-[selected=true]:bg-alpha-6',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:cursor-default data-[disabled=true]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandGroup, CommandInput, CommandItem, CommandList };
