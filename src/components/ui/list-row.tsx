import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import { cn } from '@/lib/utils';

// The shared list-item primitive: files list, plugins rows,
// settings rows, notification items. One row = leading icon/thumb slot +
// title/meta stack + trailing slot. Hover is a full-row alpha tint; rows are
// divider-less by default (spacing separates) — dense tables opt into
// hairline dividers via <ListRowGroup divide>.
//
// Composition over config: the row is a layout frame; what goes in the slots
// is the caller's. Use `asChild` to render the row as a Link/button while
// keeping the row styling.

export const ListRowGroup = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLUListElement> & { divide?: boolean }
>(({ className, divide = false, ...props }, ref) => (
  <ul
    ref={ref}
    className={cn('flex flex-col', divide && 'divide-y divide-alpha-6', className)}
    {...props}
  />
));
ListRowGroup.displayName = 'ListRowGroup';

export interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}

export const ListRow = React.forwardRef<HTMLDivElement, ListRowProps>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left',
          'hover:bg-alpha-6',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          className,
        )}
        {...props}
      />
    );
  },
);
ListRow.displayName = 'ListRow';

/** Leading slot: an icon well (or pass a thumbnail directly). */
export function ListRowIcon({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md',
        "bg-alpha-6 text-muted-foreground [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      aria-hidden
      {...props}
    />
  );
}

/** The title + meta stack. */
export function ListRowContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)} {...props} />;
}

export function ListRowTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('break-words sm:truncate text-title-card text-foreground', className)}
      {...props}
    />
  );
}

export function ListRowMeta({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('break-words sm:truncate text-meta text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Trailing slot: timestamps, badges, hover actions. */
export function ListRowTrailing({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex shrink-0 items-center gap-2', className)} {...props} />;
}
