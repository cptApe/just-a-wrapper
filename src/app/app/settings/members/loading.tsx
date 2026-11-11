import { MembersPageSkeleton } from './members-page-skeleton';

// Route-level loading frame for /settings/members: the prefetched fallback paints
// the page instantly on nav. The whole page (header included) is data-backed —
// the header action needs the caller's role — so this shares MembersPageSkeleton
// with the page's own Boundary and the two loading stages are identical. The
// `w-full md:pt-8` reading column lives here and in page.tsx (mirroring account/
// general), so the skeleton itself stays frame-free and never double-nests.
export default function Loading() {
  return (
    <div className="w-full md:pt-8">
      <MembersPageSkeleton />
    </div>
  );
}
