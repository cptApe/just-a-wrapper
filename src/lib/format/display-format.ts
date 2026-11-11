// The two things every date and clock formatter needs to know about the reader. On the server
// they come from the caller's preferences; in the browser from the provider the layout feeds.

export type TimeFormat = '12h' | '24h';

export type DisplayFormat = { timeZone: string; timeFormat: TimeFormat };

// Used where nobody is signed in (public pages, emails): UTC and the 12-hour clock.
export const FALLBACK_DISPLAY_FORMAT: DisplayFormat = { timeZone: 'UTC', timeFormat: '12h' };

// Every formatter in this folder formats in this one locale.
export const FORMAT_LOCALE = 'en-US';
