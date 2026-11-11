'use client';

import Link from 'next/link';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconClock,
  IconStopCircle,
  IconXCircle,
} from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { formatCalendarWeekday, formatHourClock } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { type CalendarEvent, calendarEventStatus } from '../lib/calendar-events';
import { type MonthGridDay, toCalendarDay } from '../lib/month-grid';
import { openScheduledTask } from '../lib/open-scheduled-task';
import { SCHEDULED_STATUS_COLORS } from '../lib/scheduled-colors';

export function ScheduledAgenda({
  weeks,
  eventsByDay,
}: {
  weeks: MonthGridDay[][];
  eventsByDay: Map<string, CalendarEvent[]>;
}) {
  const days = weeks
    .flat()
    .filter((day) => day.inMonth && (eventsByDay.get(day.key)?.length ?? 0) > 0);
  if (days.length === 0)
    return (
      <p className="px-3 py-4 text-meta font-normal text-muted-foreground">
        No scheduled runs this month
      </p>
    );

  return (
    <ol className="divide-y divide-border">
      {days.map((day) => (
        <li key={day.key}>
          <time
            dateTime={day.key}
            className="flex h-8 items-center px-3 text-meta font-medium text-muted-foreground"
          >
            {formatCalendarWeekday(toCalendarDay(day.date))}
          </time>
          <ul className="divide-y divide-border">
            {(eventsByDay.get(day.key) ?? []).map((event) => (
              <AgendaEvent
                key={`${event.kind}-${event.item.source}-${event.item.id}`}
                event={event}
              />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function AgendaEvent({ event }: { event: CalendarEvent }) {
  const display = useDisplayFormat();
  const title = event.item.title || 'Untitled run';
  const status = calendarEventStatus(event);
  const StatusIcon =
    status === 'upcoming'
      ? IconClock
      : status === 'failed'
        ? IconXCircle
        : status === 'stopped'
          ? IconStopCircle
          : status === 'succeeded'
            ? IconCheckCircle
            : IconAlertCircle;
  const color =
    status === 'upcoming' ? SCHEDULED_STATUS_COLORS.tool_gate : SCHEDULED_STATUS_COLORS[status];
  const body = (
    <>
      <StatusIcon className={cn('size-4 shrink-0', color)} aria-hidden />
      <span className="sr-only">
        {event.kind === 'attention'
          ? 'Needs attention'
          : status === 'upcoming'
            ? 'Upcoming'
            : status}
      </span>
      <time
        dateTime={event.occurredAt.toISOString()}
        className="w-16 shrink-0 text-meta font-medium text-muted-foreground tabular-nums"
      >
        {formatHourClock(event.occurredAt, display)}
      </time>
      <span className="min-w-0 flex-1 truncate text-title-card font-medium">{title}</span>
    </>
  );
  const className =
    'flex h-11 w-full min-w-0 items-center justify-start gap-2 rounded-md px-3 py-0 text-left hover:bg-alpha-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  return (
    <li className="min-w-0">
      {event.item.source === 'task' ? (
        <Button
          variant="ghost"
          className={className}
          title={title}
          onClick={() => {
            if (event.item.source === 'task') openScheduledTask(event.item);
          }}
        >
          {body}
        </Button>
      ) : (
        <Link href={event.item.href} title={title} className={className}>
          {body}
        </Link>
      )}
    </li>
  );
}
