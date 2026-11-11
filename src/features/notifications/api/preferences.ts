'use server';

import { eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { notificationPreference } from '@/db/schema';
import { resolveUser } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { withRequestContext } from '@/lib/request-context';
import { DEFAULT_PREFERENCES } from '../constants';
import { categoryChannels } from '../lib/preference-rows';
import { preferenceCategorySchema, preferencePatchSchema } from '../lib/preference-update';
import type { NotificationPreferences, PreferenceCategory, PreferencePatch } from '../types';

// Preferences are user scoped; feed reads and email delivery apply the same stored choices.

async function requireUserId(): Promise<string> {
  return (await resolveUser(await headers())).userId;
}

/** Every category's record, defaults merged over the caller's stored rows. */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return withRequestContext({ route: 'settings/notifications/get' }, async () => {
    const userId = await requireUserId();
    const rows = await db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));

    const merged: NotificationPreferences = { ...DEFAULT_PREFERENCES };

    for (const row of rows) merged[row.category] = { inApp: row.inApp, email: row.email };
    return merged;
  });
}

/** Upsert one category's preference. Only the fields in `patch` change. */
export async function setNotificationPreference(
  category: PreferenceCategory,
  patch: PreferencePatch,
): Promise<void> {
  return withRequestContext({ route: 'settings/notifications/set' }, async () => {
    const parsedCategory = preferenceCategorySchema.safeParse(category);
    const parsedPatch = preferencePatchSchema.safeParse(patch);
    if (!parsedCategory.success || !parsedPatch.success) {
      throw new AppError('UNEXPECTED', 'invalid notification preference input', {
        category,
        issues: [
          ...(parsedCategory.success ? [] : parsedCategory.error.issues),
          ...(parsedPatch.success ? [] : parsedPatch.error.issues),
        ],
      });
    }
    const cat = parsedCategory.data;
    const changes = parsedPatch.data;
    // A channel the page does not offer for this category controls nothing, so it is not stored.
    const channels = categoryChannels(cat);
    if (
      (changes.email !== undefined && !channels.email) ||
      (changes.inApp !== undefined && !channels.inApp)
    ) {
      throw new AppError('UNEXPECTED', 'notification channel not offered for this category', {
        category: cat,
        patch: changes,
      });
    }
    const userId = await requireUserId();
    const defaults = DEFAULT_PREFERENCES[cat];

    // Update touches only the changed columns; insert fills the untouched ones
    // from the category defaults, since an absent row was the default state.
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (changes.inApp !== undefined) set.inApp = changes.inApp;
    if (changes.email !== undefined) set.email = changes.email;

    await db
      .insert(notificationPreference)
      .values({
        userId,
        category: cat,
        inApp: changes.inApp ?? defaults.inApp,
        email: changes.email ?? defaults.email,
      })
      .onConflictDoUpdate({
        target: [notificationPreference.userId, notificationPreference.category],
        set,
      });
  });
}
