import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { UsagePageSkeleton } from './usage-skeleton';

// Route-level loading frame for /settings/usage: the prefetched fallback paints
// the page instantly on nav. Same account/general frame as the loaded page (the
// title is static, so it renders real); the body shares UsagePageSkeleton with the
// page's own cold-load Boundary so the two loading stages are identical.
export default function Loading() {
  return (
    <div className="w-full md:pt-8">
      <SettingsPageHeader title="Usage" />
      <UsagePageSkeleton />
    </div>
  );
}
