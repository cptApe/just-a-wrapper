import { AccountProfileFormSkeleton } from '@/features/auth';

// Route-level loading frame for /settings/account. The page blocks navigation
// (it awaits the session before rendering), so this prefetched fallback is
// what paints instantly on nav — mirroring the page's own max-w-2xl column so
// the account form drops in without the column shifting.
export default function Loading() {
  return (
    <div className="w-full md:pt-8">
      <AccountProfileFormSkeleton />
    </div>
  );
}
