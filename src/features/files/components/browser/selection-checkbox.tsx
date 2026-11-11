'use client';

import { IconCheck } from '@/components/icons';
import { cn } from '@/lib/utils';

export function SelectionCheckbox({
  name,
  checked,
  forceVisible,
  onToggle,
  className,
}: {
  name: string;
  checked: boolean;
  /** Selection mode active — every checkbox stays visible, not just hovered. */
  forceVisible: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'relative max-sm:after:absolute max-sm:after:top-1/2 max-sm:after:left-1/2 max-sm:after:min-h-11 max-sm:after:min-w-11 max-sm:after:-translate-x-1/2 max-sm:after:-translate-y-1/2 inline-flex size-6 items-center justify-center rounded-full',
        'transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        checked
          ? 'bg-foreground text-background'
          : 'bg-background/80 shadow-[inset_0_0_0_1px_var(--color-alpha-16)]',
        checked || forceVisible
          ? 'opacity-100'
          : // Touch has no hover, so the control stays visible there.
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
        className,
      )}
    >
      {checked ? <IconCheck className="size-3.5" aria-hidden /> : null}
    </button>
  );
}
