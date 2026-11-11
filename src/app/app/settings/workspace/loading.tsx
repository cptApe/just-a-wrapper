import { WorkspacePageSkeleton } from './workspace-page-skeleton';

// Route-level loading frame for /settings/workspace: the prefetched fallback
// paints the page instantly on nav. The whole page is data-backed (it resolves
// the caller's role first), so this shares WorkspacePageSkeleton with the page's
// own Boundary and the two loading stages are identical.
export default function Loading() {
  return (
    <div className="w-full md:pt-8">
      <WorkspacePageSkeleton />
    </div>
  );
}
