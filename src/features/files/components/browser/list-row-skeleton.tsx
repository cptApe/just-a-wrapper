import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// The one source of the list's column geometry, shared by the header row and the
// trailing skeleton row below so every row settles on the same columns.
export const ROW_GRID =
  'grid grid-cols-[24px_minmax(0,1fr)_44px] sm:grid-cols-[24px_minmax(0,1fr)_96px_160px_88px_40px] items-center gap-x-4 px-3';

// Hairline under a row, inset to line up with the columns rather than the highlight.
export const ROW_RULE =
  'after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-alpha-6';

export function ListRowSkeleton() {
  return (
    <div aria-hidden className={cn(ROW_GRID, ROW_RULE, 'relative h-[65px]')}>
      <span />
      <span className="flex min-w-0 items-center gap-3">
        <Skeleton className="size-[30px] rounded-md" />
        <Skeleton className="h-4 w-48 min-w-0 max-w-full rounded-sm" />
      </span>
      <Skeleton className="hidden sm:block h-4 w-10 rounded-sm" />
      <Skeleton className="hidden sm:block h-4 w-20 rounded-sm" />
      <Skeleton className="hidden sm:block h-4 w-12 rounded-sm" />
      <span />
    </div>
  );
}
