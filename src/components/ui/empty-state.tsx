import * as React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Shared empty state: muted icon tile, title and optional description/action.
 * Use theme tokens and title-only by default. Titles omit a final period.
 * See docs/spec/08-design-system.md §7. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-5 rounded-xl bg-alpha-3 px-6 py-16 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="inline-flex size-12 items-center justify-center rounded-full bg-alpha-8 text-muted-foreground"
      >
        <Icon className="size-6" />
      </div>
      <div className="flex max-w-[460px] flex-col gap-1.5">
        <p className="text-balance text-body-lg text-foreground">{title}</p>
        {description && (
          <p className="text-balance text-meta text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
