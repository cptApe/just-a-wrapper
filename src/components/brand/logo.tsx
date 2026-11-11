import { brand } from '@/lib/brand/identity';
import { cn } from '@/lib/utils';

/** The mark on a 64 by 64 grid: a sweet wrapper with nothing inside. `src/app/icon.svg` holds the same path. */
export const LOGO_MARK_PATH =
  'M14.61 28.72L28.72 14.61A9.98 9.98 0 0 1 42.84 14.61L49.39 21.16A9.98 9.98 0 0 1 49.39 35.28L35.28 49.39A9.98 9.98 0 0 1 21.16 49.39L14.61 42.84A9.98 9.98 0 0 1 14.61 28.72ZM20.2 33.71A2.99 2.99 0 0 0 20.2 37.95L26.05 43.8A2.99 2.99 0 0 0 30.29 43.8L43.8 30.29A2.99 2.99 0 0 0 43.8 26.05L37.95 20.2A2.99 2.99 0 0 0 33.71 20.2ZM42.74 18.03L45.13 3.41Q45.36 2 45.88 3.33Q50.05 13.95 60.67 18.12Q62 18.64 60.59 18.87L45.97 21.26ZM21.26 45.97L18.87 60.59Q18.64 62 18.12 60.67Q13.95 50.05 3.33 45.88Q2 45.36 3.41 45.13L18.03 42.74Z';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <svg aria-hidden="true" className="size-9 shrink-0" viewBox="0 0 64 64" fill="currentColor">
        <path d={LOGO_MARK_PATH} />
      </svg>
      <span className="font-semibold text-body-lg tracking-tight">{brand.name}</span>
    </span>
  );
}
