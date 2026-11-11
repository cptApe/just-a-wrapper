import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { resolveUser } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { FALLBACK_DISPLAY_FORMAT } from '@/lib/format/display-format';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import { getRequestSession } from '@/lib/request-session';
import { parseReplyLanguage } from '../lib/reply-language';
import {
  isValidTimeZone,
  localeFromAcceptLanguage,
  resolveEffectiveTimeZone,
  resolveTimeFormat,
} from '../lib/time-preferences';
import type { DisplayPreferences, TimePreferences } from '../types';

// Better Auth’s updateUser can bypass our action validation; invalid stored values must resolve to browser defaults.
export async function getTimePreferences(headers: Headers): Promise<TimePreferences> {
  const { userId } = await resolveUser(headers);
  const row = (
    await db
      .select({
        browserTimezone: user.browserTimezone,
        timezone: user.timezone,
        timeFormat: user.timeFormat,
        replyLanguage: user.replyLanguage,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
  ).at(0);
  if (!row) throw new AppError('UNAUTHENTICATED', 'Signed-in user has no account row', { userId });
  const { browserTimezone, timezone, timeFormat, replyLanguage } = row;
  return {
    timezone: timezone && isValidTimeZone(timezone) ? timezone : null,
    browserTimezone: browserTimezone && isValidTimeZone(browserTimezone) ? browserTimezone : null,
    timeFormat: timeFormat === '12h' || timeFormat === '24h' ? timeFormat : null,
    replyLanguage: parseReplyLanguage(replyLanguage),
  };
}

// The zone and clock every server render formats a date or time with, so the first
// paint already matches the person's settings. An unset format follows the request's locale.
export async function getDisplayPreferences(headers: Headers): Promise<DisplayPreferences> {
  const prefs = await getTimePreferences(headers);
  return {
    timeZone: resolveEffectiveTimeZone(prefs, logger()),
    timeFormat: resolveTimeFormat({
      timeFormat: prefs.timeFormat,
      locale: localeFromAcceptLanguage(headers.get('accept-language')),
    }),
  };
}

// For surfaces a signed-out person can also reach (the app shell before the auth gate, the
// admin console on loopback). No session, or a failed read, formats in UTC and 12-hour time.
export async function getOptionalDisplayPreferences(headers: Headers): Promise<DisplayPreferences> {
  if ((await getRequestSession()) === null) return FALLBACK_DISPLAY_FORMAT;
  try {
    return await getDisplayPreferences(headers);
  } catch (error) {
    captureException(error, { feature: 'preferences', op: 'display-preferences' });
    return FALLBACK_DISPLAY_FORMAT;
  }
}
