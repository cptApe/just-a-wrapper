import { PageShell } from '@/components/layouts/page-shell';
import { ScheduledPageSkeleton } from './scheduled-page-skeleton';

// Route-level loading boundary for /app/scheduled: the prefetched fallback
// paints the page frame instantly on navigation; the page's own Boundary then
// continues with the same skeleton while the groups query resolves.
export default function Loading() {
  return (
    <PageShell>
      <ScheduledPageSkeleton />
    </PageShell>
  );
}
