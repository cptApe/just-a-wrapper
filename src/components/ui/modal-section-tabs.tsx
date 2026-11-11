'use client';

import { type KeyboardEvent, useRef } from 'react';
import { cn } from '@/lib/utils';

// The section switch inside a detail modal — a real tablist (roving arrow-key
// focus, Home/End, aria-controls wiring), skinned exactly like the app-wide
// segmented pill (a per-tab alpha-6 fill; no slide, per the app-wide instant
// decision). Shared so every tool modal (apps AND built-ins) carries the same
// structure. Panels are wired by id: <ModalSectionTabs idPrefix> pairs with the
// panel's id/aria-labelledby using the same value keys.

export type ModalSectionTab<V extends string> = { value: V; label: string };

export function ModalSectionTabs<V extends string>({
  value,
  options,
  onChange,
  label,
  idPrefix,
}: {
  value: V;
  options: ReadonlyArray<ModalSectionTab<V>>;
  onChange: (value: V) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** Stable prefix for tab/panel ids (pass the same to the panel). */
  idPrefix: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const index = options.findIndex((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = options.length;
    const current = index < 0 ? 0 : index;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % count;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      next = (current - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    const option = options.at(next);
    if (!option) return;
    onChange(option.value);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex h-9 shrink-0 items-center gap-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${option.value}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${option.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-button px-4 text-title-card font-medium whitespace-nowrap select-none',
              'transition-[color] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              selected
                ? 'bg-alpha-6 text-foreground'
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

// Shared panel wrapper so both modals wire aria + focus ring identically.
export function ModalSectionPanel({
  idPrefix,
  value,
  children,
}: {
  idPrefix: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      tabIndex={0}
      className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
    >
      {children}
    </div>
  );
}
