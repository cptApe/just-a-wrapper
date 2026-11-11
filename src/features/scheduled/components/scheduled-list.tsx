'use client';

import { useState } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { scheduleLabel } from '@/features/tasks/lib/schedule-label';
import type { TaskScheduledItem } from '@/features/tasks/types';
import { usePrefetchOnIntent } from '@/hooks/use-prefetch-on-intent';
import { formatCompactDateTime, formatDateTime } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { fetchEditableTask } from '../api/fetch-editable-task';
import { scheduledQueryKeys } from '../api/keys';
import { SCHEDULED_HEADER_HEIGHT_CLASS } from '../constants';
import type { ScheduleGroups } from '../lib/group-schedules';
import { futureNextRun } from '../lib/next-run';
import { nextRunFromCron } from '../lib/next-run-from-cron';
import { openScheduledTask } from '../lib/open-scheduled-task';
import { ScheduleIcon, scheduleIconColor } from './schedule-icon';
import { ScheduledTaskMenu } from './scheduled-task-menu';

// The Tasks list: one soft container with padding, rows that round on hover
// like every other item list in the app (Library, Tools), no borders and no
// row dividers. Columns line up through one shared grid template.

const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_2.25rem] items-center gap-x-3';

export function ScheduledList({ groups }: { groups: ScheduleGroups }) {
  const [renderedAt] = useState(() => Date.now());
  const tasks = [...groups.active, ...groups.paused, ...groups.finished];
  return (
    <div className="overflow-x-auto rounded-xl bg-alpha-3 px-2 py-2 md:pt-0">
      <div role="table" aria-label="Scheduled tasks" className="min-w-0 md:min-w-[620px]">
        <div
          role="row"
          className={cn(
            GRID,
            SCHEDULED_HEADER_HEIGHT_CLASS,
            'hidden md:grid px-3 text-meta font-medium text-muted-foreground',
          )}
        >
          <span role="columnheader">Name</span>
          <span role="columnheader" className="hidden md:block">
            Schedule
          </span>
          <span role="columnheader">Next run</span>
          <span role="columnheader" className="hidden md:block">
            Status
          </span>
          <span role="columnheader" className="hidden md:sr-only md:block">
            Actions
          </span>
        </div>
        {tasks.map((task) => (
          <ScheduleRow key={task.id} task={task} renderedAt={renderedAt} />
        ))}
      </div>
      {tasks.length === 0 && (
        <p className="rounded-lg bg-alpha-3 px-3 py-10 text-center text-meta font-normal text-muted-foreground">
          No schedules found
        </p>
      )}
    </div>
  );
}

function ScheduleRow({ task, renderedAt }: { task: TaskScheduledItem; renderedAt: number }) {
  const organizationId = useOrganizationId();
  const display = useDisplayFormat();
  const { onIntent } = usePrefetchOnIntent();
  const live = task.state !== 'paused' && task.state !== 'finished';
  const next =
    futureNextRun(task.occurredAt, renderedAt) ??
    (live && task.triggerType === 'schedule' && !task.runAt && task.cronSchedule
      ? nextRunFromCron(task.cronSchedule, task.timezone, renderedAt)
      : null);
  const state =
    task.state === 'finished'
      ? 'Finished'
      : task.state === 'paused'
        ? 'Paused'
        : task.state === 'stale'
          ? 'Missed run'
          : 'Active';
  const prefetch = () => {
    if (organizationId)
      onIntent(scheduledQueryKeys.detail(organizationId, task.id), ({ signal }) =>
        fetchEditableTask(task.id, signal),
      );
  };
  const open = () => openScheduledTask(task);
  return (
    <div
      role="row"
      className={cn(
        GRID,
        'relative min-h-11 max-md:gap-y-1 max-md:py-3 md:min-h-14 rounded-md px-3 text-meta hover:bg-alpha-6 focus-within:bg-alpha-6',
      )}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-on-media',
            scheduleIconColor(task.icon),
          )}
        >
          <ScheduleIcon icon={task.icon} triggerType={task.triggerType} className="size-4" />
        </span>
        {/* The stretched title makes the whole row one control while the menu stays above it. */}
        <button
          type="button"
          onClick={open}
          onMouseEnter={prefetch}
          onFocus={prefetch}
          className="min-w-0 break-words text-left md:truncate text-title-card font-medium after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          title={task.title}
        >
          {task.title}
        </button>
      </div>
      <div role="cell" className="hidden text-meta font-normal text-muted-foreground md:block">
        {scheduleLabel(task, { kind: 'person', timeFormat: display.timeFormat })}
      </div>
      <div
        role="cell"
        className="max-md:col-start-1 max-md:row-start-2 max-md:pl-10 whitespace-normal md:whitespace-nowrap text-meta font-medium text-muted-foreground"
        suppressHydrationWarning
      >
        <span className="md:hidden">
          {next ? `Next ${formatCompactDateTime(next, display)}` : state}
          {next && state !== 'Active' ? ` · ${state}` : null}
        </span>
        <span className="hidden md:inline">{next ? formatDateTime(next, display) : '—'}</span>
      </div>
      <div role="cell" className="hidden md:block">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              task.state === 'paused'
                ? 'bg-warning'
                : task.state === 'stale'
                  ? 'bg-destructive'
                  : task.state === 'finished'
                    ? 'bg-muted-foreground'
                    : 'bg-success',
            )}
          />
          {state}
        </span>
      </div>
      <div
        role="cell"
        className="relative flex justify-end max-md:col-start-2 max-md:row-start-1 max-md:row-span-2"
      >
        <ScheduledTaskMenu task={task} />
      </div>
    </div>
  );
}
