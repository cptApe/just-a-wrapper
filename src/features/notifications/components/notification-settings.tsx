'use client';

import { SettingsConfigureRow } from '@/components/settings/settings-configure-row';
import { SettingsSection } from '@/components/settings/settings-section';
import { Switch } from '@/components/ui/switch';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { useNotificationPreferences } from '../hooks/use-notification-preferences';
import { AWAY_THRESHOLD_MINUTES } from '../lib/events';
import { PREFERENCE_ROWS } from '../lib/preference-rows';
import type { NotificationPreferences, PreferenceCategory, PreferencePatch } from '../types';

// Pending switch writes overlay the server cache.

export function NotificationSettings({
  initial,
  emailEnabled,
}: {
  initial: NotificationPreferences;
  emailEnabled: boolean;
}) {
  const { prefs, update: mutate } = useNotificationPreferences(initial);
  function update(category: PreferenceCategory, patch: PreferencePatch) {
    mutate({ category, patch });
  }
  return (
    <>
      {emailEnabled ? null : (
        <p role="status" className="pb-4 text-meta text-muted-foreground">
          {CAPABILITY_OFF_MESSAGES.email}
        </p>
      )}
      <SettingsSection divided={false}>
        {PREFERENCE_ROWS.map((row) => (
          <SettingsConfigureRow key={row.category} label={row.label} description={row.description}>
            <ChannelToggles
              category={row.category}
              categoryLabel={row.label}
              channels={row.channels}
              inApp={prefs[row.category].inApp}
              email={emailEnabled && prefs[row.category].email}
              emailEnabled={emailEnabled}
              onChange={(patch) => update(row.category, patch)}
            />
          </SettingsConfigureRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Task alerts" divided={false}>
        <SettingsConfigureRow
          label="Email me if a task needs input or finishes while I'm away"
          description={
            emailEnabled
              ? `Away means about ${AWAY_THRESHOLD_MINUTES} minutes without activity`
              : CAPABILITY_OFF_MESSAGES.email
          }
          htmlFor="task-alerts-email"
        >
          <Switch
            id="task-alerts-email"
            aria-label="Email task alerts"
            checked={emailEnabled && prefs.task_alerts.email}
            disabled={!emailEnabled}
            onCheckedChange={(checked) => update('task_alerts', { email: checked })}
          />
        </SettingsConfigureRow>
      </SettingsSection>
    </>
  );
}

// The labeled channel switches on the right of a category row, one per channel its events
// use. With email off the Email switch stays visible and off; the page's notice says why.
function ChannelToggles({
  category,
  categoryLabel,
  channels,
  inApp,
  email,
  emailEnabled,
  onChange,
}: {
  category: PreferenceCategory;
  categoryLabel: string;
  channels: { inApp: boolean; email: boolean };
  inApp: boolean;
  email: boolean;
  emailEnabled: boolean;
  onChange: (patch: PreferencePatch) => void;
}) {
  return (
    <div className="flex items-center gap-5">
      {channels.inApp ? (
        <SwitchField
          id={`${category}-in-app`}
          label="In-app"
          categoryLabel={categoryLabel}
          checked={inApp}
          onCheckedChange={(checked) => onChange({ inApp: checked })}
        />
      ) : null}
      {channels.email ? (
        <SwitchField
          id={`${category}-email`}
          label="Email"
          categoryLabel={categoryLabel}
          checked={email}
          disabled={!emailEnabled}
          onCheckedChange={(checked) => onChange({ email: checked })}
        />
      ) : null}
    </div>
  );
}

function SwitchField({
  id,
  label,
  categoryLabel,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  id: string;
  label: string;
  categoryLabel: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-meta text-muted-foreground select-none">
        {label}
      </label>
      <Switch
        id={id}
        aria-label={`${categoryLabel}: ${label}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
