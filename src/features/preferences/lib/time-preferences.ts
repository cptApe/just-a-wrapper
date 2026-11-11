import { z } from 'zod';
import type { TimeFormat } from '@/lib/format/display-format';

// Shared time-preference helpers for Settings/General. The server validation
// boundaries and client rows import from here so they never disagree on valid
// values.

const TIME_FORMATS = ['12h', '24h'] as const satisfies readonly TimeFormat[];

export type { TimeFormat };

// Picker choices are canonical names; validation also accepts runtime-supported aliases.
export const IANA_TIME_ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

export function isValidTimeZone(value: string): boolean {
  // Reject blanks consistently across runtimes; accept aliases and case variants recognized by Intl.
  if (!value) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (error) {
    // An unknown zone is invalid input (→ false), not a failure to report.
    // Anything else is a real bug; rethrow so it is never swallowed.
    if (error instanceof RangeError) return false;
    throw error;
  }
}

// The browser's own zone, captured by the app shell for the "Auto" preference.
// Meaningful only on the client because the server resolves to its host zone.
export function detectTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// The clock a person sees: their Time format setting, else their locale's hour cycle
// (only h23/h24 select 24h), else 12-hour. The browser passes navigator.language; a
// server render passes the request's Accept-Language; an email, with no locale, passes null.
export function resolveTimeFormat(input: {
  timeFormat: string | null;
  locale: string | null;
}): TimeFormat {
  if (input.timeFormat === '12h' || input.timeFormat === '24h') return input.timeFormat;
  if (input.locale === null) return '12h';
  let hourCycle: string | undefined;
  try {
    ({ hourCycle } = new Intl.DateTimeFormat(input.locale, { hour: 'numeric' }).resolvedOptions());
  } catch (error) {
    // A malformed locale tag is input, not a failure; the unset default applies.
    if (error instanceof RangeError) return '12h';
    throw error;
  }
  return hourCycle === 'h23' || hourCycle === 'h24' ? '24h' : '12h';
}

// The first language tag of an Accept-Language header ("en-GB,en;q=0.9" → "en-GB").
export function localeFromAcceptLanguage(header: string | null): string | null {
  const first = header?.split(',')[0]?.split(';')[0]?.trim();
  return first && first !== '*' ? first : null;
}

export type EffectiveTimeZoneInput = {
  timezone?: string | null;
  browserTimezone?: string | null;
};

type TimeZoneWarningLogger = {
  warn(fields: { invalidTimeZone: string }, message: string): void;
};

// The single precedence rule used wherever server behavior depends on the
// user's zone. Invalid stored values are warned through the caller's structured
// logger, then skipped so a valid lower-priority value can still win.
export function resolveEffectiveTimeZone(
  input: EffectiveTimeZoneInput,
  warningLogger: TimeZoneWarningLogger,
): string {
  for (const value of [input.timezone, input.browserTimezone]) {
    if (!value) continue;
    if (isValidTimeZone(value)) return value;
    warningLogger.warn({ invalidTimeZone: value }, 'invalid stored timezone; using fallback');
  }
  return 'UTC';
}

// Server-action input boundaries. null clears a preference back to "derive from
// the browser"; a present timezone must be a real IANA zone.
export const timeZoneInputSchema = z
  .string()
  .refine(isValidTimeZone, { message: 'Unknown time zone' })
  .nullable();

export const timeFormatInputSchema = z.enum(TIME_FORMATS);

// The human label for a stored time format — the current-state value the
// Settings/General row shows ("12-hour" / "24-hour"), not "12h/24h" chrome.
export function timeFormatLabel(format: TimeFormat): string {
  return format === '12h' ? '12-hour' : '24-hour';
}
