import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { composerCardClass, composerCardInnerClass } from '../lib/composer-geometry';

// Home loading uses a server-safe composer skeleton with shared geometry classes.
// Task loading uses the real interactive composer so typing works immediately.
export function ComposerSkeleton() {
  return (
    <div data-skeleton="composer" className={cn(composerCardClass, 'border-alpha-8')}>
      <div className={composerCardInnerClass}>
        <div className="flex min-h-9 flex-col justify-center">
          <Skeleton className="ml-1 h-4 w-56 max-w-full" />
        </div>
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Skeleton className="size-9 max-md:size-11 rounded-button" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-9 max-md:size-11 rounded-button" />
            <Skeleton className="size-9 max-md:size-11 rounded-button" />
          </div>
        </div>
      </div>
    </div>
  );
}
