import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { user } from '@/db/schema';
import { resolveUser } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { isValidTimeZone } from '../lib/time-preferences';

/**
 * Persist the signed-in user's browser-detected IANA timezone. `zoneChanged` is true when the
 * person's effective zone moved: the stored browser zone changed while their setting is Auto.
 */
export async function updateBrowserTimeZone(input: {
  headers: Headers;
  timezone: string;
}): Promise<{ timezone: string; userId: string; zoneChanged: boolean }> {
  if (!isValidTimeZone(input.timezone)) {
    throw new AppError('INVALID_BODY', 'Time zone must be a valid IANA time zone', {
      timezone: input.timezone,
      expectedState: true,
    });
  }

  const { userId } = await resolveUser(input.headers);

  // The write is skipped in SQL when the stored zone already matches.
  const rows = await db
    .update(user)
    .set({ browserTimezone: input.timezone })
    .where(
      and(eq(user.id, userId), sql`${user.browserTimezone} is distinct from ${input.timezone}`),
    )
    .returning({ timezone: user.timezone });

  return {
    timezone: input.timezone,
    userId,
    // The browser zone applies whenever no valid zone is stored (resolveEffectiveTimeZone).
    zoneChanged: rows.some((row) => !row.timezone || !isValidTimeZone(row.timezone)),
  };
}
