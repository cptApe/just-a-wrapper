import type { NotificationPreferences, PreferenceCategory } from './types';

// The notification-preference categories: the rows a person toggles delivery for.
// Distinct from the feed-item `category` ('needs_you' | 'fyi') in lib/events.ts, which
// only styles a feed item. The db CHECK, the zod validators and the settings UI read here.
export const PREFERENCE_CATEGORIES = [
  'account_billing',
  'connections',
  'team_sharing',
  'task_alerts',
] as const;

// The two-channel rows of the settings page, in display order. Which switches each row
// shows comes from the events (lib/preference-rows.ts). task_alerts has its own section.
export const PREFERENCE_CATEGORY_META: ReadonlyArray<{
  category: Exclude<PreferenceCategory, 'task_alerts'>;
  label: string;
  description: string;
}> = [
  {
    category: 'account_billing',
    label: 'Account & billing',
    description: 'Plan changes, invoices, and payment issues',
  },
  {
    category: 'connections',
    label: 'Connections',
    description: 'When an integration disconnects or needs your attention',
  },
  {
    category: 'team_sharing',
    label: 'Team & sharing',
    description: 'When someone joins your workspace or shares a task with you',
  },
];

// An absent row means the category default, so nothing is seeded. Task email is off.
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  account_billing: { inApp: true, email: true },
  connections: { inApp: true, email: true },
  team_sharing: { inApp: true, email: true },
  task_alerts: { inApp: true, email: false },
};
