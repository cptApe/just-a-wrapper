'use server';

import { headers } from 'next/headers';
import { listScheduledItems } from '@/features/tasks/api/list-scheduled-items';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';

// A schedule link can open its overlay before the Scheduled page has seeded the list cache.
export async function loadScheduleSummary(taskId: string): Promise<TaskScheduledItem | null> {
  return withRequestContext({ route: 'schedule-summary', feature: 'scheduled' }, async () => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    const groups = await listScheduledItems({ workspaceId, viewerUserId: userId });
    return groups.upcoming.find((task) => task.id === taskId) ?? null;
  });
}
