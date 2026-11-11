import { GRID_LAYOUT, GridTileSkeleton } from './browser-grid';
import { ListRowSkeleton } from './list-row-skeleton';

const SKELETON_ITEMS = Array.from({ length: 6 }, (_, index) => index);

export function BrowserSkeletons({ view, label }: { view: 'grid' | 'list'; label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} data-view={view}>
      {view === 'grid' ? (
        <div className={GRID_LAYOUT}>
          {SKELETON_ITEMS.map((index) => (
            <GridTileSkeleton key={index} />
          ))}
        </div>
      ) : (
        SKELETON_ITEMS.map((index) => <ListRowSkeleton key={index} />)
      )}
    </div>
  );
}
