import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { NotificationSettingsSkeleton } from '@/features/notifications';

// Route-level loading frame for /settings/notifications: the prefetched fallback
// paints the page instantly on nav. The "Notifications" page title is static, so
// it renders real; the settings themselves share NotificationSettingsSkeleton
// with the page's own Boundary so the two loading stages are identical.
export default function Loading() {
  return (
    <div className="w-full md:pt-8">
      <SettingsPageHeader title="Notifications" />
      <div className="pt-8">
        <NotificationSettingsSkeleton />
      </div>
    </div>
  );
}
