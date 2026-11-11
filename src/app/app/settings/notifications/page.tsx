import type { Metadata } from 'next';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { NotificationSettings, NotificationSettingsSkeleton } from '@/features/notifications';
import { getNotificationPreferences } from '@/features/notifications/server';
import { brand } from '@/lib/brand/identity';
import { capabilities } from '@/lib/runtime-capabilities';

export const metadata: Metadata = {
  title: `Notifications · ${brand.name}`,
};

// Notification settings merge stored rows with defaults.
// Render loading and error boundaries; each toggle owns its save state.
export default function NotificationsSettingsPage() {
  return (
    // Fill the shell’s standard reading column; md:pt-8 aligns the title with Library.
    <div className="w-full md:pt-8">
      <SettingsPageHeader title="Notifications" />
      <div className="pt-8">
        <Boundary loading={<NotificationSettingsSkeleton />} error={<NotificationsError />}>
          <NotificationsLoader />
        </Boundary>
      </div>
    </div>
  );
}

async function NotificationsLoader() {
  const prefs = await getNotificationPreferences();
  return <NotificationSettings initial={prefs} emailEnabled={capabilities.email.kind !== 'off'} />;
}

function NotificationsError() {
  return (
    <ErrorState
      title="Couldn’t load your notifications"
      message="Something went wrong reading your notification settings. Reload the page to try again."
    />
  );
}
