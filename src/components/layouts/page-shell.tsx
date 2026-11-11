import * as React from 'react';
import { cn } from '@/lib/utils';

// Standard pages share one centred maximum width, with title and actions
// inside the column. Home and Task own their layouts within the same width.
// The page and sidebar inherit --background to avoid a painted seam.
// See docs/spec/08-design-system.md §4.

/** @deprecated Every value renders the same page width. Omit this prop in new code. */
export type PageWidth = 'reading' | 'content' | 'wide';

export function PageShell({
  as: Comp = 'main',
  className,
  children,
}: {
  /** @deprecated Ignored — all pages render the one fixed max-width. */
  width?: PageWidth;
  /** Pages keep the default <main>; embedded demos (showcase) use 'div' so
      they don't nest a second main landmark. */
  as?: 'main' | 'div';
  className?: string;
  children: React.ReactNode;
}) {
  return <Comp className={cn('w-full', className)}>{children}</Comp>;
}

// The page gutter: 16px on phones, 24px on small tablets, 40px from md. The
// settings shell and StickyToolbar use the same steps.
const PAGE_COLUMN = 'mx-auto w-full max-w-page px-4 sm:px-6 md:px-10';

/** Below md the phone top bar names the page, so the title is kept only for
    assistive technology and the header starts with its actions. */
export function PageHeader({
  title,
  action,
  tabs,
  className,
}: {
  /** The one page title — exactly one per page. */
  title: React.ReactNode;
  /** The single primary action, top right (one button). */
  action?: React.ReactNode;
  /** Optional tabs row (line variant) or search/filter row, full-width below. */
  tabs?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn(PAGE_COLUMN, 'flex flex-col gap-5 pt-4 md:pt-20', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5 max-md:sr-only">
          <h1 className="text-title-page text-foreground">{title}</h1>
        </div>
        {action ? (
          <div className="flex shrink-0 items-center gap-2 max-md:w-full">{action}</div>
        ) : null}
      </div>
      {tabs}
    </header>
  );
}

/** The content block under a PageHeader — owns the standard top/bottom padding.
    Below md every page uses the same 16px gap under the toolbar. */
export function PageBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn(PAGE_COLUMN, 'pt-8 pb-24', className, 'max-md:pt-4')} {...props} />;
}
