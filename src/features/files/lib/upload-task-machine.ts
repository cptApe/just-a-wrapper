export type UploadTask = { id: string; filename: string } & (
  | { status: 'uploading'; progress: number }
  | { status: 'syncing'; progress: 1 }
  | { status: 'error'; progress: number }
);
export type UploadEvent =
  | { type: 'start'; id: string; filename: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'sync'; id: string }
  | { type: 'fail'; id: string }
  | { type: 'remove'; id: string };

export function uploadTaskReducer(tasks: UploadTask[], event: UploadEvent): UploadTask[] {
  if (event.type === 'start') {
    if (tasks.some((task) => task.id === event.id)) return tasks;
    return [...tasks, { id: event.id, filename: event.filename, status: 'uploading', progress: 0 }];
  }
  if (event.type === 'remove') return tasks.filter((task) => task.id !== event.id);
  return tasks.map((task) => {
    if (task.id !== event.id || task.status === 'error') return task;
    switch (event.type) {
      case 'progress':
        return task.status === 'uploading' ? { ...task, progress: event.progress } : task;
      case 'sync':
        return task.status === 'uploading' ? { ...task, status: 'syncing', progress: 1 } : task;
      case 'fail':
        return { ...task, status: 'error' };
    }
  });
}
