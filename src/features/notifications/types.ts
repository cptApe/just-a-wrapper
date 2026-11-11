import type { FeedMetadata } from './lib/feed-schema';

export type FeedViewStatus = 'loading' | 'ready' | 'error';

export const EMPTY_FEED_METADATA: FeedMetadata = {
  totalCount: 0,
  unreadCount: 0,
  unseenCount: 0,
};

// Derive the union from the settings array so validation, storage and UI cannot drift.
export type PreferenceCategory = typeof import('./constants').PREFERENCE_CATEGORIES[number];

type CategoryPreference = { inApp: boolean; email: boolean };

export type NotificationPreferences = Record<PreferenceCategory, CategoryPreference>;

export type PreferencePatch = Partial<CategoryPreference>;

export type EmailLayoutInput = {
  heading: string;
  lines: string[];
  button?: { label: string; url: string };
  highlight?: string;
  footerReason: string;
  /** The Questions? line of the footer, from readContactDetails. */
  supportEmail: string;
};
