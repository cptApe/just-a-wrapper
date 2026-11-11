'use client';

import { cn } from '@/lib/utils';

// One row of filter pills (All / Unread on notifications, template categories
// on Scheduled). The active pill is filled; the rest are quiet text. Same
// classes as the notifications feed filter so every pill row reads the same.
// Below md the row stays on one line and scrolls sideways, with the shared
// scroll-fade-x edge fade, instead of wrapping onto a second line. Phone pills
// are 36px tall with body-size labels.
export function PillTabs<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center gap-1',
        'max-md:min-w-0 max-md:max-w-full max-md:flex-nowrap max-md:overflow-x-auto max-md:overscroll-x-contain max-md:scroll-fade-x max-md:[--scroll-fade-size:24px] max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'shrink-0 whitespace-nowrap rounded-button px-3 py-1.5 text-meta font-medium max-sm:h-9 max-sm:py-0 max-sm:text-body',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            // The scrolling phone row clips anything outside a pill, so the ring sits inside.
            'max-md:focus-visible:ring-inset max-md:focus-visible:ring-offset-0',
            value === option.value
              ? 'bg-alpha-12 text-foreground'
              : 'text-muted-foreground hover:bg-alpha-6 hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
