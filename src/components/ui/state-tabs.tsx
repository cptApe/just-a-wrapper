'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// StateTabs — a controlled single-choice switcher that reads like a small tab
// list (iOS-style segmented tabs), not a toggle. Purpose-built for a row that
// carries a fixed set of mutually exclusive STATES shown icon-only, each with a
// tooltip label — the per-tool permission control (allow / ask first / block)
// in the tool modals. It is deliberately NOT `Segmented` (a page/view switch
// with a sliding pill): that reads as its own thing. This is a compact track
// of icon segments where the active
// one is filled.
//
// Radiogroup semantics with roving focus (arrow keys move + select). Unlike the
// value pickers it models a fixed always-present state set, so there is no
// deselect — you move between states, you never clear to none. A `null` value
// renders with NO active segment (an inherited/unset state shown accurately), but
// clicking any segment always sets a concrete state.

export type StateTab<V extends string> = {
  value: V;
  /** Icon-only content for the segment. */
  icon: React.ReactNode;
  /** Native tooltip + accessible name for the segment. */
  label: string;
};

export function StateTabs<V extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  className,
}: {
  /** Current state; null renders no active segment (inherited/unset). */
  value: V | null;
  options: ReadonlyArray<StateTab<V>>;
  onChange: (value: V) => void;
  /** Accessible group label (e.g. "Permission for Send email"). */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  // Roving focus: the active segment is tabbable; with no value, the first is.
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = checkedIndex < 0 ? 0 : checkedIndex;

  function onKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (focusIndex + 1) % options.length;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (focusIndex - 1 + options.length) % options.length;
    }
    if (next === null) return;
    event.preventDefault();
    const option = options.at(next);
    if (!option) return;
    onChange(option.value);
    const radios = trackRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
    radios?.[next]?.focus();
  }

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        // Use one compact muted track; only the active segment has a fill.
        'inline-flex h-8 max-sm:h-9 shrink-0 items-center rounded-button bg-alpha-6 p-[3px]',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            disabled={disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              if (disabled || checked) return;
              onChange(option.value);
            }}
            className={cn(
              // Active icons use a background chip with shadow, whether explicit or inherited.
              // Inactive icons stay muted without a chip or border.
              'inline-flex h-full items-center justify-center rounded-button px-2.5 select-none',
              "[&_svg:not([class*='size-'])]:size-[18px]",
              'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              checked
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground/70 hover:text-foreground',
            )}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}
