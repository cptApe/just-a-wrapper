import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function InlinePrompt({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-destructive text-body',
        className,
      )}
      {...props}
    />
  );
}
