'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
// 28-in-36 icon pill: a 36px hit target whose visible pill is
// the 28px fill. `filled` (the close button) rests on alpha-6 so it reads over
// arbitrary content; plain pills (back, frame controls) fill on hover only.
/** Outer hit-target classes of the icon pill; shared with link-shaped pills. */
export function modalIconButtonClassName(className?: string): string {
  return cn(
    'group inline-flex size-9 max-sm:size-11 shrink-0 items-center justify-center rounded-button',
    // The focus ring hugs the visible 28px pill, not the larger hit box.
    'focus-visible:outline-none',
    'disabled:pointer-events-none disabled:opacity-40',
    className,
  );
}

/** Inner 28px pill classes; `filled` rests on alpha-6 so it reads over content. */
export function modalIconPillClassName(filled = false): string {
  return cn(
    'inline-flex size-7 items-center justify-center rounded-button text-muted-foreground',
    'transition-colors duration-150 ease-[var(--ease-out)]',
    'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1 group-focus-visible:ring-offset-background',
    filled
      ? 'bg-alpha-6 group-hover:bg-alpha-12 group-hover:text-foreground'
      : 'group-hover:bg-alpha-6 group-hover:text-foreground',
  );
}

export const ModalIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    filled?: boolean;
  }
>(({ label, filled = false, children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    className={modalIconButtonClassName(className)}
    {...props}
  >
    <span aria-hidden className={modalIconPillClassName(filled)}>
      {children}
    </span>
  </button>
));
ModalIconButton.displayName = 'ModalIconButton';
