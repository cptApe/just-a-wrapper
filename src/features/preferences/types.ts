import type { ActionState } from '@/lib/action-state';
import type { DisplayFormat } from '@/lib/format/display-format';
import type { ReplyLanguage } from './lib/reply-language';
import type { TimeFormat } from './lib/time-preferences';

// The member's stored display preferences, resolved server-side from the Better
// Auth user row. A null timezone means Auto, which uses browserTimezone. A null
// time format is derived from the browser locale.
export type TimePreferences = {
  timezone: string | null;
  browserTimezone: string | null;
  timeFormat: TimeFormat | null;
  replyLanguage: ReplyLanguage | null;
};

// What a formatter needs to show a date or a clock time the way this person reads them.
export type DisplayPreferences = DisplayFormat;

/** The server actions that save each preference, passed in by the page that composes the rows. */
export type SavePreferenceAction<Value> = (value: Value) => Promise<ActionState<void>>;
