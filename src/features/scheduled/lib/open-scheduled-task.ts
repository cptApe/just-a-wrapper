import { buildOverlayHash } from '@/features/overlays/lib/hash';
import { openOverlay } from '@/features/overlays/lib/overlay-history';

/** Schedule definitions are overlays, never application routes. */
export function openScheduledTask(task: {
  id: string;
  state: import('@/features/tasks/lib/schedule-state').ScheduleState;
}): void {
  openOverlay(
    buildOverlayHash(
      'new-schedule',
      task.id,
      task.state === 'finished' || task.state === 'running' ? undefined : { edit: '1' },
    ),
  );
}
