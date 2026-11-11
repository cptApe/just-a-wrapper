'use server';

import { headers } from 'next/headers';
import {
  preferenceBoundary,
  saveReplyLanguage,
  saveTimeFormat,
  saveTimeZone,
} from '@/features/preferences/api/save-preferences';
import { scheduleCreatorTaskSync } from '@/features/tasks/api/sync-creator-tasks';
import { type ActionState, runAction } from '@/lib/action-state';

// Settings → General's saves. They live above preferences and tasks because a changed zone or
// language must reach the person's scheduled tasks at once, not on the next daily sweep.

export async function updateTimeZoneAction(value: string | null): Promise<ActionState<void>> {
  return runAction(
    preferenceBoundary(
      'settings/general/timezone',
      'Could not save your time zone. Please try again.',
    ),
    async () => {
      const saved = await saveTimeZone(await headers(), value);
      if (saved.changed) scheduleCreatorTaskSync(saved.userId);
    },
  );
}

export async function updateReplyLanguageAction(value: string | null): Promise<ActionState<void>> {
  return runAction(
    preferenceBoundary(
      'settings/general/reply-language',
      'Could not save your agent language. Please try again.',
    ),
    async () => {
      const saved = await saveReplyLanguage(await headers(), value);
      if (saved.changed) scheduleCreatorTaskSync(saved.userId);
    },
  );
}

// A task's deployment does not carry the time format, so this save reaches no task.
export async function updateTimeFormatAction(value: string): Promise<ActionState<void>> {
  return runAction(
    preferenceBoundary(
      'settings/general/time-format',
      'Could not save your time format. Please try again.',
    ),
    async () => {
      await saveTimeFormat(await headers(), value);
    },
  );
}
