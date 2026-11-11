import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[120px] w-full rounded-md bg-alpha-6 px-3.5 py-2.5',
        'text-body-lg sm:text-body text-foreground placeholder:text-foreground-tertiary',
        'transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
        'field-focus',
        'aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none',
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';
