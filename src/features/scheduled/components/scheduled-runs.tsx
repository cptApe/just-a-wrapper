'use client';

import Link from 'next/link';
import { IconAlertCircle, IconCheckCircle, IconStopCircle, IconXCircle } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import type { ScheduledGroups, ScheduledRunRow } from '@/features/tasks/types';
import { formatCompactDateTime, formatDateTime } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { SCHEDULED_HEADER_HEIGHT_CLASS } from '../constants';
import { SCHEDULED_STATUS_COLORS } from '../lib/scheduled-colors';
import { scheduledRunRows } from '../lib/scheduled-run-rows';
import { ScheduleIcon, scheduleIconColor } from './schedule-icon';

const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] items-center gap-x-3';
const STATUS = {
  succeeded: {
    label: 'Succeeded',
    icon: IconCheckCircle,
    color: SCHEDULED_STATUS_COLORS.succeeded,
  },
  failed: { label: 'Failed', icon: IconXCircle, color: SCHEDULED_STATUS_COLORS.failed },
  stopped: { label: 'Stopped', icon: IconStopCircle, color: SCHEDULED_STATUS_COLORS.stopped },
  out_of_credits: {
    label: 'Out of credits',
    icon: IconAlertCircle,
    color: SCHEDULED_STATUS_COLORS.out_of_credits,
  },
  tool_gate: {
    label: 'Needs approval',
    icon: IconAlertCircle,
    color: SCHEDULED_STATUS_COLORS.tool_gate,
  },
};

export function ScheduledRuns({ groups, query }: { groups: ScheduledGroups; query: string }) {
  const rows = scheduledRunRows(groups, query);
  const header = (
    <div
      role="row"
      className={cn(
        GRID,
        SCHEDULED_HEADER_HEIGHT_CLASS,
        'px-3 text-meta font-medium text-muted-foreground',
      )}
    >
      <span role="columnheader" className="pl-7">
        Run
      </span>
      <span role="columnheader" className="hidden md:block">
        Task
      </span>
      <span role="columnheader">Time</span>
    </div>
  );
  // Empty: the column titles keep their place at the top of the soft card and
  // the message sits in its own inner card below them.
  if (rows.length === 0) {
    return (
      <div className="overflow-x-auto rounded-xl bg-alpha-3 px-2 pb-2">
        <div role="table" aria-label="Scheduled runs" className="min-w-0">
          {header}
        </div>
        <p className="rounded-lg bg-alpha-3 px-3 py-10 text-center text-meta font-normal text-muted-foreground">
          {query.trim() ? 'No runs match your search' : 'No runs yet'}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl bg-alpha-3 px-2 pb-2">
      <div role="table" aria-label="Scheduled runs" className="min-w-0 md:min-w-[620px]">
        {header}
        {rows.map((row) => (
          <RunRow key={row.run.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ row }: { row: ScheduledRunRow }) {
  const display = useDisplayFormat();
  const status = STATUS[row.status];
  const StatusIcon = status.icon;
  return (
    <div
      role="row"
      className={cn(
        GRID,
        'relative min-h-11 md:min-h-14 rounded-md px-3 text-meta hover:bg-alpha-6 focus-within:bg-alpha-6',
      )}
    >
      <div role="cell" className="flex min-w-0 items-center gap-3">
        <StatusIcon aria-hidden className={cn('size-4 shrink-0', status.color)} />
        <div className="min-w-0">
          <Link
            href={row.run.href}
            className="block truncate text-title-card font-medium after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            title={row.run.title ?? 'Untitled run'}
          >
            {row.run.title ?? 'Untitled run'}
          </Link>
          <span className="sr-only">{status.label}</span>
        </div>
      </div>
      <div
        role="cell"
        className="hidden min-w-0 items-center gap-2 text-meta font-normal text-muted-foreground md:flex"
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-on-media',
            scheduleIconColor(row.taskIcon),
          )}
        >
          <ScheduleIcon icon={row.taskIcon} triggerType="schedule" className="size-4" />
        </span>
        <span className="truncate" title={row.taskTitle}>
          {row.taskTitle}
        </span>
      </div>
      <div
        role="cell"
        className="whitespace-nowrap text-meta font-medium text-muted-foreground tabular-nums"
        suppressHydrationWarning
      >
        <time dateTime={new Date(row.run.occurredAt).toISOString()}>
          <span className="md:hidden">{formatCompactDateTime(row.run.occurredAt, display)}</span>
          <span className="hidden md:inline">{formatDateTime(row.run.occurredAt, display)}</span>
        </time>
      </div>
    </div>
  );
}
