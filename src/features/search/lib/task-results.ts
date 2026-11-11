import type { WorkspaceSessionListItem } from '@/features/sessions';
import { SEARCH_RESULTS_PER_GROUP } from '../constants';
import type { ServerSearchResult } from '../types';
import { normalizeQuery } from './match';

export function taskStatusSubtitle(status: WorkspaceSessionListItem['status']): string | undefined {
  switch (status) {
    case 'running':
    case 'rescheduling':
      return 'Running';
    case 'requires_input':
      return 'Needs your input';
    case 'paused_no_credits':
      return 'Paused';
    case 'terminated':
      return 'Stopped';
    default:
      return undefined;
  }
}

/** Match the task pages already held by the sidebar's shared React Query cache. */
export function matchCachedTaskTitles(
  tasks: readonly WorkspaceSessionListItem[],
  query: string,
): ServerSearchResult[] {
  const q = normalizeQuery(query).toLowerCase();
  if (q === '') return [];

  const seen = new Set<string>();
  return tasks
    .filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return task.title?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aPrefix = a.title?.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.title?.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      const aActiveAt = a.lastEventAt ?? a.createdAt;
      const bActiveAt = b.lastEventAt ?? b.createdAt;
      return bActiveAt.getTime() - aActiveAt.getTime();
    })
    .slice(0, SEARCH_RESULTS_PER_GROUP)
    .map((task) => ({
      group: 'task' as const,
      id: task.id,
      title: task.title ?? 'Untitled task',
      subtitle: taskStatusSubtitle(task.status),
      href: `/app/task/${task.id}`,
    }));
}

/** Keep live cached task rows first, then append server-only/older matches. */
export function mergeSearchResults(
  cachedTasks: readonly ServerSearchResult[],
  serverResults: readonly ServerSearchResult[],
): ServerSearchResult[] {
  const cachedTaskIds = new Set(cachedTasks.map((result) => result.id));
  const taskResults = [
    ...cachedTasks,
    ...serverResults.filter((result) => result.group === 'task' && !cachedTaskIds.has(result.id)),
  ].slice(0, SEARCH_RESULTS_PER_GROUP);
  return [...taskResults, ...serverResults.filter((result) => result.group !== 'task')];
}
