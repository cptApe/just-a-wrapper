import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '@/db';
import { user } from '@/db/schema';
import { resolveUser } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { replyLanguageInputSchema } from '../lib/reply-language';
import { timeFormatInputSchema, timeZoneInputSchema } from '../lib/time-preferences';

// The saves behind Settings → General. The server actions that call them live with the page's
// composition (settings), because a saved zone or language also reaches the person's tasks.

/** Who saved, and whether the stored value changed. */
type PreferenceSave = { userId: string; changed: boolean };

/**
 * A rejected value is a validation gate, not an incident: its message is the copy the row
 * toasts. Every other failure shows the row's fixed save-failure copy.
 */
export function preferenceBoundary(route: string, saveFailed: string) {
  return {
    route,
    feature: 'preferences',
    message: saveFailed,
    appErrorMessage: (error: AppError) =>
      error.code === 'TOOL_INPUT_INVALID' ? error.message : saveFailed,
    expected: (error: AppError) => error.code === 'TOOL_INPUT_INVALID',
  };
}

function parsePreference<T>(schema: z.ZodType<T>, value: unknown, invalid: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError('TOOL_INPUT_INVALID', invalid, {});
  return parsed.data;
}

/** null clears the stored zone back to Auto (derived from the browser). */
export async function saveTimeZone(headers: Headers, value: unknown): Promise<PreferenceSave> {
  const timezone = parsePreference(timeZoneInputSchema, value, 'That is not a valid time zone.');
  const { userId } = await resolveUser(headers);
  const rows = await db
    .update(user)
    .set({ timezone })
    .where(
      and(
        eq(user.id, userId),
        isNull(user.deletedAt),
        sql`${user.timezone} is distinct from ${timezone}`,
      ),
    )
    .returning({ id: user.id });
  return { userId, changed: rows.length > 0 };
}

export async function saveReplyLanguage(headers: Headers, value: unknown): Promise<PreferenceSave> {
  const replyLanguage = parsePreference(
    replyLanguageInputSchema,
    value,
    'That is not a language we support.',
  );
  const { userId } = await resolveUser(headers);
  const rows = await db
    .update(user)
    .set({ replyLanguage })
    .where(
      and(
        eq(user.id, userId),
        isNull(user.deletedAt),
        sql`${user.replyLanguage} is distinct from ${replyLanguage}`,
      ),
    )
    .returning({ id: user.id });
  return { userId, changed: rows.length > 0 };
}

export async function saveTimeFormat(headers: Headers, value: unknown): Promise<PreferenceSave> {
  const timeFormat = parsePreference(
    timeFormatInputSchema,
    value,
    'That is not a valid time format.',
  );
  const { userId } = await resolveUser(headers);
  const rows = await db
    .update(user)
    .set({ timeFormat })
    .where(
      and(
        eq(user.id, userId),
        isNull(user.deletedAt),
        sql`${user.timeFormat} is distinct from ${timeFormat}`,
      ),
    )
    .returning({ id: user.id });
  return { userId, changed: rows.length > 0 };
}
