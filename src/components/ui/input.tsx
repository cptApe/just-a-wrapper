import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 max-sm:h-9 w-full rounded-md bg-alpha-6 px-3.5 py-1',
        'text-body-lg sm:text-body text-foreground placeholder:text-foreground-tertiary',
        'transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
        'field-focus',
        'aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-body file:font-medium',
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = 'Input';
