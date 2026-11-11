import { Skeleton } from '@/components/ui/skeleton';
import {
  homeColumnClass,
  homeGreetingClass,
  homeScrollAreaClass,
  homeSpacerBottomClass,
  homeSpacerMidClass,
  homeSpacerTopClass,
  homeTopRowClass,
} from '../lib/home-geometry';
import { ComposerSkeleton } from './composer-skeleton';

// Home loading shares frame classes with HomeView and the composer skeleton.
// Match tier/credit pill dimensions and greeting height so data replaces geometry
// without shifting the page.
export function HomeViewSkeleton() {
  return (
    <main className="flex h-full flex-col" aria-busy="true" aria-label="Loading home">
      <div className={homeTopRowClass}>
        {/* Reserves the drawer trigger's box <md so the tier pill does not jump
            left when the real MobileNavButton mounts. md:hidden, mirroring the
            loaded row. */}
        <Skeleton className="-ml-2 size-11 shrink-0 rounded-button md:hidden" />
        <Skeleton className="h-11 w-32 rounded-button" />
        <div className="flex-1" />
        <Skeleton className="h-11 w-20 rounded-button" />
      </div>
      <div className={homeScrollAreaClass}>
        <div aria-hidden className={homeSpacerTopClass} />
        <div className={homeColumnClass}>
          <div className={homeGreetingClass}>
            <Skeleton className="mx-auto h-[38px] w-72 max-w-full rounded-sm" />
          </div>
        </div>
        <div aria-hidden className={homeSpacerMidClass} />
        <div className={homeColumnClass}>
          <ComposerSkeleton />
        </div>
        <div aria-hidden className={homeSpacerBottomClass} />
      </div>
    </main>
  );
}
