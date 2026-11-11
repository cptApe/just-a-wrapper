import { GeneralPageSkeleton } from './general-page-skeleton';

// Route-level loading frame for /settings/general: the prefetched fallback paints
// the whole page instantly on nav. Once the RSC arrives, the static title and
// Language row render real and only the two time rows re-suspend inside the
// page's Boundary — which shares TimeRowsSkeleton with this frame.
export default function Loading() {
  return <GeneralPageSkeleton />;
}
