import { SettingsConfigureRow } from '@/components/settings/settings-configure-row';
import { SettingsSection } from '@/components/settings/settings-section';
import { Skeleton } from '@/components/ui/skeleton';
import { AWAY_THRESHOLD_MINUTES } from '../lib/events';
import { PREFERENCE_ROWS } from '../lib/preference-rows';

// Mirrors NotificationSettings: the category rows with their channel switches, then
// the Task alerts section.

// The h-6 w-10 Switch shape (switch.tsx), state unknown so it pulses.
function SwitchSkeleton() {
  return <Skeleton className="h-6 w-10 rounded-full" />;
}

// The labelled channel switches on the right of a category row
// (notification-settings.tsx ChannelToggles): flex gap-5, each a label + switch.
function ChannelTogglesSkeleton({ channels }: { channels: { inApp: boolean; email: boolean } }) {
  return (
    <div className="flex items-center gap-5">
      {channels.inApp ? (
        <div className="flex items-center gap-2">
          <span className="text-meta text-muted-foreground select-none">In-app</span>
          <SwitchSkeleton />
        </div>
      ) : null}
      {channels.email ? (
        <div className="flex items-center gap-2">
          <span className="text-meta text-muted-foreground select-none">Email</span>
          <SwitchSkeleton />
        </div>
      ) : null}
    </div>
  );
}

export function NotificationSettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading notification settings">
      <SettingsSection divided={false}>
        {PREFERENCE_ROWS.map((row) => (
          <SettingsConfigureRow key={row.category} label={row.label} description={row.description}>
            <ChannelTogglesSkeleton channels={row.channels} />
          </SettingsConfigureRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Task alerts" divided={false}>
        <SettingsConfigureRow
          label="Email me if a task needs input or finishes while I'm away"
          description={`Away means about ${AWAY_THRESHOLD_MINUTES} minutes without activity`}
        >
          <SwitchSkeleton />
        </SettingsConfigureRow>
      </SettingsSection>
    </div>
  );
}
