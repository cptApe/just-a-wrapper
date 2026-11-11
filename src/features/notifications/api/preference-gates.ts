import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { notificationPreference } from '@/db/schema';
import { DEFAULT_PREFERENCES } from '../constants';
import type { PreferenceCategory } from '../types';

// Missing rows use category defaults, including task email off.
// Select opted-in recipients in one query rather than one request per user.
export async function emailEnabledUserIds(
  userIds: string[],
  category: PreferenceCategory,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const stored = await db
    .select({ userId: notificationPreference.userId, email: notificationPreference.email })
    .from(notificationPreference)
    .where(
      and(
        inArray(notificationPreference.userId, userIds),
        eq(notificationPreference.category, category),
      ),
    );
  const enabled = new Map(stored.map((r) => [r.userId, r.email]));
  return new Set(userIds.filter((id) => enabled.get(id) ?? DEFAULT_PREFERENCES[category].email));
}

// The categories one user has turned OFF in-app — the feed read filter hides
// items whose category is in this set. A category with no row (default on) is
// never returned, so the feed shows everything by default.
export async function mutedInAppCategories(userId: string): Promise<PreferenceCategory[]> {
  const rows = await db
    .select({ category: notificationPreference.category })
    .from(notificationPreference)
    .where(and(eq(notificationPreference.userId, userId), eq(notificationPreference.inApp, false)));
  return rows.map((r) => r.category);
}
