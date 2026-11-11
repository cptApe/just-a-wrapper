'use client';

import * as React from 'react';
import { IconSearchMd, IconX } from '@/components/icons';
import { cn } from '@/lib/utils';

// Shared header search pill uses theme alpha fills and borders for contrast.
// Focus adds a neutral ring without changing size.
// A custom clear button replaces the native glyph; its space stays reserved
// so text does not move when the button appears.

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className={cn('relative w-[180px] max-md:min-w-0 max-md:flex-1 md:w-[240px]', className)}>
      <IconSearchMd
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-foreground-tertiary"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          'h-9 w-full rounded-button bg-alpha-3 dark:bg-alpha-8 pl-10 pr-10',
          'text-body-lg sm:text-title-card text-foreground placeholder:text-foreground-tertiary',
          'shadow-[inset_0_0_0_1px_var(--color-alpha-16)]',
          'transition-[box-shadow] duration-150 ease-[var(--ease-out)]',
          'field-focus',
          // Remove the browser's native (blue, emoji-font) clear glyph; we
          // render our own below. display:none is definitive where
          // -webkit-appearance:none is not always honored.
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className={cn(
            'absolute right-2 max-sm:right-0 top-1/2 flex size-6 max-sm:size-9 -translate-y-1/2 items-center justify-center rounded-button',
            'text-foreground-tertiary',
            'transition-colors duration-150 ease-[var(--ease-out)]',
            'hover:bg-alpha-6 hover:text-foreground',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          )}
        >
          <IconX className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
