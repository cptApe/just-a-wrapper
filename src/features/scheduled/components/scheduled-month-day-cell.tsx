'use client';

import Link from 'next/link';
import * as React from 'react';
import { IconAlertCircle, IconCheckCircle, IconStopCircle, IconXCircle } from '@/components/icons';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { Button } from '@/components/ui/button';
import { formatHourClock } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { type CalendarEvent, calendarEventStatus } from '../lib/calendar-events';
import { openScheduledTask } from '../lib/open-scheduled-task';
import { calendarEventColors } from '../lib/scheduled-colors';
import { ScheduleIcon } from './schedule-icon';

const MAX_CHIPS_PER_DAY = 3;

const ATTENTION_COPY = {
  out_of_credits: 'Out of credits',
  tool_gate: 'Needs approval',
} as const;

export const dayNumberClass =
  'flex size-6 items-center justify-center self-end rounded-full text-meta font-medium tabular-nums';

export function ScheduledMonthDayCell({
  dayOfMonth,
  dateLabel,
  inMonth,
  isToday,
  events,
}: {
  dayOfMonth: number;
  dateLabel: string;
  inMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}) {
  const cellRef = React.useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = React.useState(false);
  const overflow = Math.max(events.length - MAX_CHIPS_PER_DAY, 0);
  const visibleEvents = expanded ? events : events.slice(0, MAX_CHIPS_PER_DAY);

  React.useEffect(() => {
    if (!isToday || !window.matchMedia('(max-width: 767px)').matches) return;
    const cell = cellRef.current;
    const scroller = cell?.closest<HTMLElement>('[data-month-grid-scroll]');
    if (!cell || !scroller) return;
    const cellRect = cell.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    scroller.scrollLeft +=
      cellRect.left - scrollerRect.left - (scroller.clientWidth - cellRect.width) / 2;
  }, [isToday]);

  return (
    <div
      ref={cellRef}
      data-date={dateLabel}
      className={cn('flex min-h-28 flex-col gap-1 p-1.5', isToday && 'bg-alpha-3')}
    >
      <span
        suppressHydrationWarning
        className={cn(
          dayNumberClass,
          inMonth ? 'text-foreground' : 'text-foreground-tertiary',
          isToday && 'bg-primary text-primary-foreground',
        )}
      >
        {dayOfMonth}
      </span>
      <div
        className={cn(
          'space-y-1',
          expanded && 'max-h-36 overflow-y-auto overscroll-y-contain pr-0.5',
        )}
      >
        {visibleEvents.map((event) => (
          <EventChip key={`${event.kind}-${event.item.source}-${event.item.id}`} event={event} />
        ))}
      </div>
      {overflow > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Show fewer events for ${dateLabel}`
              : `Show ${overflow} more events for ${dateLabel}`
          }
          onClick={() => setExpanded((current) => !current)}
          className="w-fit rounded-sm px-1 text-meta font-medium text-muted-foreground hover:bg-alpha-6 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? 'Show fewer' : `+${overflow} more`}
        </button>
      )}
    </div>
  );
}

function EventChip({ event }: { event: CalendarEvent }) {
  const display = useDisplayFormat();
  const status = calendarEventStatus(event);
  const RunIcon =
    event.kind === 'attention'
      ? IconAlertCircle
      : status === 'failed'
        ? IconXCircle
        : status === 'stopped'
          ? IconStopCircle
          : IconCheckCircle;
  const title = event.item.title || 'Untitled run';
  const attentionCopy = event.attentionReason ? ATTENTION_COPY[event.attentionReason] : null;
  const tooltip = `${formatHourClock(event.occurredAt, display)} · ${title}${attentionCopy ? ` · ${attentionCopy}` : ''}`;
  const className = cn(
    'flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-meta font-medium',
    calendarEventColors(event),
  );

  const body = (
    <>
      {event.item.source === 'task' ? (
        <ScheduleIcon
          icon={event.item.icon}
          triggerType={event.item.triggerType}
          className="size-3.5 shrink-0"
        />
      ) : (
        <RunIcon className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <time className="shrink-0 font-medium">{formatHourClock(event.occurredAt, display)}</time>
    </>
  );

  if (event.item.source === 'task') {
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn(className, 'justify-start')}
        title={tooltip}
        onClick={() => {
          if (event.item.source === 'task') openScheduledTask(event.item);
        }}
      >
        {body}
      </Button>
    );
  }

  return (
    <Link
      href={event.item.href}
      title={tooltip}
      className={cn(
        className,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      )}
    >
      {body}
    </Link>
  );
}
