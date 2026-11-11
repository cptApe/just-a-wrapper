import type { WorkspaceSessionListItem } from '@/features/sessions';
import type { SearchFilter, ServerSearchResult } from '../types';
import { matchesQuery } from './match';
import { ACTION_COMMANDS, availableSettingsCommands } from './static-commands';

export const SEARCH_FILTERS: ReadonlyArray<{ value: SearchFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'library', label: 'Files' },
  { value: 'app', label: 'Apps' },
  { value: 'scheduled', label: 'Scheduled' },
];

export function filterSearchResults(results: readonly ServerSearchResult[], filter: SearchFilter) {
  return results.filter(
    (item) =>
      filter === 'all' ||
      item.group === filter ||
      (filter === 'library' && item.group === 'memory') ||
      (filter === 'app' && item.group === 'skill'),
  );
}

export function matchingCommands(
  query: string,
  filter: SearchFilter,
  { billingEnabled }: { billingEnabled: boolean },
) {
  if (filter !== 'all' || !query.trim()) return [];
  return [...availableSettingsCommands(billingEnabled), ...ACTION_COMMANDS].filter((command) =>
    matchesQuery(query, command.title),
  );
}

/** Use the sidebar's workspace cache, ordered by activity rather than pin date. */
export function recentSearchTasks(
  tasks: readonly WorkspaceSessionListItem[],
): ServerSearchResult[] {
  const seen = new Set<string>();
  return tasks
    .filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort(
      (a, b) => (b.lastEventAt ?? b.createdAt).getTime() - (a.lastEventAt ?? a.createdAt).getTime(),
    )
    .slice(0, 6)
    .map((task) => ({
      group: 'task',
      id: task.id,
      title: task.title ?? 'Untitled task',
      href: `/app/task/${task.id}`,
    }));
}
