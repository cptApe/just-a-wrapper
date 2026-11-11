import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type CountBadgeProps = Omit<ComponentProps<'span'>, 'children'> & {
  count: number;
};

export function CountBadge({ count, className, ...props }: CountBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      data-slot="count-badge"
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-badge text-count text-badge-foreground tabular-nums',
        count < 10 ? 'w-5' : 'px-1.5',
        className,
      )}
      {...props}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
