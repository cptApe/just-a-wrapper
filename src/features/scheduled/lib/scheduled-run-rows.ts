import type {
  ScheduledGroups,
  ScheduledRunRow,
  SessionScheduledItem,
} from '@/features/tasks/types';

function runStatus(run: SessionScheduledItem) {
  return run.status ?? (run.reviewOutcome === 'not_passed' ? 'failed' : 'succeeded');
}

export function scheduledRunRows(groups: ScheduledGroups, query: string): ScheduledRunRow[] {
  const tasks = new Map(groups.upcoming.map((task) => [task.id, task]));
  const attentionIds = new Set(groups.attention.map((run) => run.id));
  const newestFirst = (a: SessionScheduledItem, b: SessionScheduledItem) =>
    new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  const rows = [
    ...[...groups.attention].sort(newestFirst).map((run) => ({ run, status: run.reason })),
    ...groups.history
      .filter((run) => !attentionIds.has(run.id))
      .sort(newestFirst)
      .map((run) => ({ run, status: runStatus(run) })),
  ].map(({ run, status }) => {
    const task = run.taskId ? tasks.get(run.taskId) : undefined;
    return {
      run,
      status,
      taskTitle: task ? task.title : (run.taskTitle ?? (run.taskId ? 'Deleted task' : 'Chat')),
      // Live task icon wins over the run snapshot.
      taskIcon: task?.icon != null ? task.icon : (run.taskIcon ?? null),
    };
  });
  const search = query.trim().toLowerCase();
  return rows.filter(({ run, taskTitle }) =>
    `${run.title ?? ''} ${taskTitle}`.toLowerCase().includes(search),
  );
}
