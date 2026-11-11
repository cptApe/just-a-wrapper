import { PageShell } from '@/components/layouts/page-shell';
import { LibraryPageSkeleton } from './library-page-skeleton';

// Route-level loading boundary for /app/library: the prefetched fallback
// paints the page frame instantly on navigation; the page's own Boundary then
// continues with the same skeleton while page 0 assembles.
export default function Loading() {
  return (
    <PageShell width="reading">
      <LibraryPageSkeleton />
    </PageShell>
  );
}
