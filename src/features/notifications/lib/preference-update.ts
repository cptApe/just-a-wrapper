import { z } from 'zod';
import { PREFERENCE_CATEGORIES } from '../constants';
import type { NotificationPreferences } from '../types';
export const preferenceCategorySchema = z.enum(PREFERENCE_CATEGORIES);
export const preferencePatchSchema = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .strict();
export const preferenceUpdateSchema = z.object({
  category: preferenceCategorySchema,
  patch: preferencePatchSchema,
});

// Pending mutations overlay the server cache; removing a failed attempt reveals the current
// server value without restoring an obsolete snapshot over another successful change.
export function projectPreferences(
  preferences: NotificationPreferences,
  updates: z.infer<typeof preferenceUpdateSchema>[],
): NotificationPreferences {
  return updates.reduce(
    (current, update) => ({
      ...current,
      [update.category]: { ...current[update.category], ...update.patch },
    }),
    preferences,
  );
}
