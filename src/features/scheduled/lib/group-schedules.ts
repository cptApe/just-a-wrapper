import type { AttentionItem, TaskScheduledItem } from '@/features/tasks/types';

// Group tasks into four states without a status filter or view toggle.
// Preserve server ordering within Active: next run ascending, event tasks last.
// Pause and completion move rows into their matching group.

export type ScheduleGroups = {
  /** Sessions parked on credits or a tool gate — the workspace's needs-you inbox. */
  attention: AttentionItem[];
  /** Live schedules and event tasks. Stale rows stay here so their state word is seen. */
  active: TaskScheduledItem[];
  paused: TaskScheduledItem[];
  /** One-offs that already fired. */
  finished: TaskScheduledItem[];
};

/** Case-insensitive title/prompt match; an empty needle matches everything. */
function matchesScheduleSearch(task: TaskScheduledItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    task.title.toLowerCase().includes(needle) ||
    (task.description ?? '').toLowerCase().includes(needle)
  );
}

/** Attention rows are sessions, not tasks: match on the run title only. */
function matchesAttentionSearch(item: AttentionItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (item.title ?? '').toLowerCase().includes(needle);
}

/** Next run ascending, nulls last; ties keep the incoming (server) order. */
function byNextRun(a: TaskScheduledItem, b: TaskScheduledItem): number {
  if (a.occurredAt === null && b.occurredAt === null) return 0;
  if (a.occurredAt === null) return 1;
  if (b.occurredAt === null) return -1;
  return a.occurredAt.getTime() - b.occurredAt.getTime();
}

export function groupSchedules(input: {
  attention: readonly AttentionItem[];
  tasks: readonly TaskScheduledItem[];
  query: string;
}): ScheduleGroups {
  const query = input.query;
  const active: TaskScheduledItem[] = [];
  const paused: TaskScheduledItem[] = [];
  const finished: TaskScheduledItem[] = [];

  for (const task of input.tasks) {
    if (!matchesScheduleSearch(task, query)) continue;
    if (task.state === 'finished') finished.push(task);
    else if (task.state === 'paused') paused.push(task);
    else active.push(task);
  }

  // Array.prototype.sort is stable, so equal keys keep the server order.
  active.sort(byNextRun);

  return {
    attention: input.attention.filter((item) => matchesAttentionSearch(item, query)),
    active,
    paused,
    finished,
  };
}
