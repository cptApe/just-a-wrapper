'use client';

import * as React from 'react';
import { IconCheck, IconChevronDown, IconSearchMd } from '@/components/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { searchListReducer } from './lib/search-list-machine';

// A searchable single-select: a trigger that opens a popover with a filter input
// over a scrollable list of options. The design system's Radix `Select` has no
// filter, which is unusable for a long set (IANA zones), so this fills that gap
// with the WAI-ARIA combobox pattern — input drives an aria-activedescendant
// over role="option" rows; Up/Down move, Enter selects, Escape closes.

export type ComboboxOption = {
  value: string;
  /** Shown in the list and matched against the query. */
  label: string;
  /** Extra text folded into matching (e.g. a friendlier alias). */
  keywords?: string;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/_/g, ' ');
}

export function Combobox({
  options,
  value,
  onSelect,
  triggerLabel,
  searchPlaceholder = 'Search',
  emptyText = 'No matches',
  disabled = false,
  ariaLabel,
  className,
  contentClassName,
}: {
  options: readonly ComboboxOption[];
  /** Selected value, or null when nothing is chosen. */
  value: string | null;
  onSelect: (value: string) => void;
  /** What the trigger shows for the current selection. */
  triggerLabel: React.ReactNode;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  contentClassName?: string;
}) {
  const [state, dispatch] = React.useReducer(searchListReducer, { kind: 'closed' });
  const open = state.kind === 'open';
  const query = state.kind === 'open' ? state.query : '';
  const activeIndex = state.kind === 'open' ? state.index : 0;
  const listRef = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();
  const listId = `${baseId}-list`;

  const filtered = React.useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return options;
    return options.filter(
      (o) => normalize(o.label).includes(q) || (o.keywords && normalize(o.keywords).includes(q)),
    );
  }, [options, query]);

  // Start the active option on the current selection (or the top) so the first
  // Arrow key doesn't jump somewhere unrelated. Reset in the open handler, not
  // an effect (no cascading render).
  function onOpenChange(next: boolean) {
    dispatch(
      next
        ? { type: 'open', index: options.findIndex((option) => option.value === value) }
        : { type: 'close' },
    );
  }

  // Keep the active option scrolled into view as it moves.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function commit(index: number) {
    const option = filtered.at(index);
    if (!option) return;
    onSelect(option.value);
    dispatch({ type: 'close' });
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      dispatch({ type: 'select', index: activeIndex + 1, count: filtered.length });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      dispatch({ type: 'select', index: activeIndex - 1, count: filtered.length });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === 'Home') {
      event.preventDefault();
      dispatch({ type: 'select', index: 0, count: filtered.length });
    } else if (event.key === 'End') {
      event.preventDefault();
      dispatch({ type: 'select', index: filtered.length - 1, count: filtered.length });
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        disabled={disabled}
        aria-labelledby={`${baseId}-label ${baseId}-value`}
        className={cn(
          'flex h-9 max-sm:min-h-9 max-sm:text-body items-center justify-between gap-2 rounded-md bg-alpha-6 px-3 py-1',
          'text-title-card text-foreground',
          'transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span id={`${baseId}-label`} className="sr-only">
          {ariaLabel}
        </span>
        <span id={`${baseId}-value`} className="line-clamp-1 text-left">
          {triggerLabel}
        </span>
        <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className={cn('w-[var(--radix-popover-trigger-width)] min-w-56 p-0', contentClassName)}
        onOpenAutoFocus={(e) => {
          // Focus the search input, not the first option (combobox pattern).
          e.preventDefault();
          const input = e.currentTarget;
          if (input instanceof HTMLElement) input.querySelector<HTMLInputElement>('input')?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-glass-separator border-b px-3">
          <IconSearchMd className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            // This input is the combobox per the WAI-ARIA pattern; the popup is its listbox.
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              filtered[activeIndex] ? `${baseId}-opt-${activeIndex}` : undefined
            }
            aria-label={ariaLabel}
            value={query}
            onChange={(e) => {
              dispatch({ type: 'query', query: e.target.value });
            }}
            onKeyDown={onInputKeyDown}
            placeholder={searchPlaceholder}
            className="h-10 max-sm:h-9 w-full bg-transparent text-body max-sm:text-body-lg text-foreground outline-none placeholder:text-foreground-tertiary"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
        >
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-meta text-muted-foreground">{emptyText}</p>
          ) : (
            filtered.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`${baseId}-opt-${index}`}
                  type="button"
                  tabIndex={-1}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onClick={() => commit(index)}
                  onMouseMove={() => dispatch({ type: 'select', index, count: filtered.length })}
                  className={cn(
                    'flex w-full max-sm:min-h-9 max-sm:text-body items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-meta outline-none',
                    active && 'bg-alpha-8',
                  )}
                >
                  <span className="line-clamp-1">{option.label}</span>
                  {selected ? <IconCheck className="size-4 shrink-0" /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
