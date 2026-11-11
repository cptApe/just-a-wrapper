import { taskMachine } from '@/features/tasks/lib/task-machine';
import type { TaskScheduledItem } from '@/features/tasks/types';

// Pure updaters over the Tasks and Calendar list cache, a flat capped array. An optimistic row takes
// the status the server writes at once; the request's busy flag locks the controls meanwhile.

type Cache = TaskScheduledItem[] | undefined;

export function insertRowAtTop(cache: Cache, row: TaskScheduledItem): TaskScheduledItem[] {
  return [row, ...(cache ?? [])];
}

export function patchRow(cache: Cache, id: string, patch: Partial<TaskScheduledItem>): Cache {
  return cache?.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function rekeyRow(cache: Cache, fromId: string, toId: string): Cache {
  return cache?.map((row) => (row.id === fromId ? { ...row, id: toId } : row));
}

export function removeRow(cache: Cache, id: string): Cache {
  return cache?.filter((row) => row.id !== id);
}

/** A row the machine refuses to move keeps its server state; the request still reports the outcome. */
export function pauseRow(cache: Cache, id: string): Cache {
  return cache?.map((row) =>
    row.id === id && taskMachine.can(row.status, 'paused')
      ? { ...row, state: 'paused', status: 'paused', occurredAt: null }
      : row,
  );
}

export function resumeRow(cache: Cache, id: string): Cache {
  return cache?.map((row) =>
    row.id === id && taskMachine.can(row.status, 'upcoming')
      ? { ...row, state: 'live', status: 'upcoming' }
      : row,
  );
}
