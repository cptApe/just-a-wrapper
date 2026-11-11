'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Standard pages share a header and toolbar; see docs/spec/08-design-system.md.
// Right-anchored controls either occupy the leftmost slot or reserve their space.
// ToolbarSlot hides irrelevant controls without moving their neighbours.
// Selection swaps the left slot in place; narrow layouts wrap intact groups.

/** Reserves a toolbar control's box while it doesn't apply: fades + hides it
    (visibility keeps it untabbable/invisible to AT) without releasing layout,
    so neighbors never reflow when a state toggles it back on. */
export function ToolbarSlot({
  visible,
  className,
  children,
}: {
  visible: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 transition-opacity duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
        // visibility:hidden (not display:none) — keeps the box, drops the slot
        // from the tab order and the a11y tree, and kills pointer events.
        visible ? 'opacity-100' : 'invisible opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The hairline divider between the funnel and the view toggle. */
export function ToolbarDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('mx-1 h-5 w-px bg-alpha-8', className)} />;
}

/** 36×36 full-radius bare-glyph button; active = the soft neutral fill +
    darker glyph, with no border, shadow, or track. */
export function IconToggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-button',
        'transition-colors duration-150 ease-[var(--ease-out)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        active
          ? 'bg-alpha-6 text-foreground'
          : 'text-muted-foreground hover:bg-alpha-6 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
