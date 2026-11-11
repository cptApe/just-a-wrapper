'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// The single segmented control: mutually exclusive options on the page
// background, where the only fill is a soft neutral pill behind the active
// option. Radiogroup semantics, no Radix Tabs panel coupling. It drives view
// toggles and value pickers, so it carries a nullable value (null = unset, no
// pill) and an optional allowDeselect. The pill is measured from the checked
// option and re-measured on change and resize.

export type SegmentedOption<V extends string> = {
  value: V;
  label: React.ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
};

export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  allowDeselect = false,
  disabled = false,
  className,
}: {
  /** Current value; null renders NO thumb (an unset/inherited state). */
  value: V | null;
  options: ReadonlyArray<SegmentedOption<V>>;
  /** Called with the picked value, or null when allowDeselect clears the active option. */
  onChange: (value: V | null) => void;
  /** Accessible group label ("View", "Memory scope", …). */
  label: string;
  /** md = the 36px pill tabs; sm = a 32px compact group for option rows. */
  size?: 'md' | 'sm';
  /** When true, clicking the active option clears the selection to null. */
  allowDeselect?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  // Measure synchronously when the checked option changes, and again whenever a size changes.
  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => {
      const active = track.querySelector<HTMLElement>('[aria-checked="true"]');
      setThumb(active ? { left: active.offsetLeft, width: active.offsetWidth } : null);
    };
    update();
    const resizes = new ResizeObserver(update);
    resizes.observe(track);
    for (const child of track.children) resizes.observe(child);
    return () => resizes.disconnect();
  }, [value, options]);

  // Roving focus: the checked option is tabbable; with no value, the first is.
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
        // Use gap-1 for the shared pill gap; call sites must not override it.
        // Phones keep the desktop 36px height; the compact size grows to the
        // same 36px tap target there.
        'relative inline-flex shrink-0 items-center gap-1',
        size === 'md' ? 'h-9' : 'h-8 max-sm:h-9',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {thumb ? (
        <span
          aria-hidden
          className={cn(
            // The active state changes instantly without a slide animation.
            'absolute inset-y-0 left-0 rounded-button bg-alpha-6',
          )}
          style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        />
      ) : null}
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            disabled={disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              if (disabled) return;
              if (checked) {
                if (allowDeselect) onChange(null);
                return;
              }
              onChange(option.value);
            }}
            className={cn(
              'relative z-[1] inline-flex items-center justify-center whitespace-nowrap rounded-button select-none max-sm:text-body',
              // Text color only — transitioning background-color stacks the fading hover
              // fill on top of the instantly-moved thumb for 200ms (double-overlay flash).
              'transition-[color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              size === 'md' ? 'h-9 px-4 text-title-card' : 'h-8 px-3 text-meta max-sm:h-9',
              'font-medium',
              checked
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-alpha-6 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
