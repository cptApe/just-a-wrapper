import { BillingPageSkeleton } from './billing-page-skeleton';

// Route-level loading frame for /settings/billing. The page blocks navigation
// (force-dynamic, it awaits the billing summary), so this prefetched fallback is
// what paints instantly on nav — mirroring the loaded page frame so
// the plan actions and credits drop in without the column moving.
export default function Loading() {
  return <BillingPageSkeleton />;
}
