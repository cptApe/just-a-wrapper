import type * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { RowAction } from './row-action';

// Labels and actions are known before loading; only unknown values pulse, preserving the real row geometry.
export function SettingsDetailRowSkeleton({
  label,
  value,
  valueWidth = '12rem',
  trailing,
  destructive = false,
  layout = 'default',
}: {
  label: string;
  /** A known value, or SkeletonText for a line that wraps; omit it to pulse a bar at valueWidth. */
  value?: React.ReactNode;
  valueWidth?: string;
  /** The row action: a string renders an inert RowAction; a node renders as is. */
  trailing?: React.ReactNode;
  /** Paint a string `trailing` in the destructive colour. */
  destructive?: boolean;
  /** Match the row's layout so the skeleton geometry stays exact. */
  layout?: 'default' | 'stacked';
}) {
  const stacked = layout === 'stacked';
  return (
    <div className={cn('flex flex-col', stacked ? 'py-3' : 'gap-3 py-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className={cn('flex min-w-0 flex-col', stacked ? 'flex-1 gap-1' : 'gap-0.5')}>
          <span className="text-body font-semibold">{label}</span>
          {value !== undefined ? (
            <span
              className={cn(
                'text-muted-foreground break-words',
                stacked ? 'text-body' : 'text-meta',
              )}
            >
              {value}
            </span>
          ) : (
            <div className={cn('flex items-center', stacked ? 'h-[22px]' : 'h-[18px]')}>
              <Skeleton className="h-3.5 rounded-sm" style={{ width: valueWidth }} />
            </div>
          )}
        </div>
        {trailing ? (
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {typeof trailing === 'string' ? (
              // A real button: on phones its 44px target centers the label, which a span does not.
              <RowAction
                aria-hidden
                tabIndex={-1}
                destructive={destructive}
                className={cn(
                  'pointer-events-none',
                  stacked && !destructive && 'min-w-[3.25rem] text-right',
                )}
              >
                {trailing}
              </RowAction>
            ) : (
              trailing
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
