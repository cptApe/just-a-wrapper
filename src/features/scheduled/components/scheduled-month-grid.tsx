// The grid and skeleton share frame and cell geometry to prevent layout shifts.
// Compact chips leave room for titles in the seven-column layout.

import * as React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCalendarDate } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { SCHEDULED_HEADER_HEIGHT_CLASS } from '../constants';
import type { CalendarEvent } from '../lib/calendar-events';
import { type MonthGridDay, toCalendarDay } from '../lib/month-grid';
import { dayNumberClass, ScheduledMonthDayCell } from './scheduled-month-day-cell';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Weekday header + hairline-divided week rows. The one source of the grid's
    geometry — the real grid and the skeleton both render through it. */
function MonthGridFrame({
  weeks,
  renderDay,
}: {
  weeks: MonthGridDay[][];
  renderDay: (day: MonthGridDay) => React.ReactNode;
}) {
  return (
    <div
      data-month-grid-scroll
      className="scroll-fade overflow-x-auto overscroll-x-contain [--scroll-fade-mask:none] max-md:[--scroll-fade-mask:linear-gradient(to_right,transparent_0,var(--color-foreground)_16px,var(--color-foreground)_calc(100%_-_16px),transparent_100%)]"
    >
      <div className="min-w-0">
        <div
          data-calendar-weekdays
          className={cn('grid grid-cols-7 items-center', SCHEDULED_HEADER_HEIGHT_CLASS)}
        >
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="text-center text-meta font-medium text-muted-foreground">
              {weekday}
            </div>
          ))}
        </div>
        <div className="divide-y divide-alpha-6 border-t border-alpha-6">
          {weeks.map((week) => (
            <div
              key={week.at(0)?.key}
              className="grid grid-cols-7 divide-x divide-alpha-6 [&>div:nth-child(n+6)]:bg-alpha-3"
            >
              {week.map((day) => (
                <React.Fragment key={day.key}>{renderDay(day)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function eventsVersion(events: CalendarEvent[]): string {
  return events
    .map(
      (event) =>
        `${event.kind}:${event.item.source}:${event.item.id}:${event.item.title ?? ''}:${event.occurredAt.getTime()}:${event.attentionReason ?? ''}`,
    )
    .join('|');
}

export function ScheduledMonthGrid({
  weeks,
  todayKey,
  eventsByDay,
}: {
  weeks: MonthGridDay[][];
  todayKey: string;
  eventsByDay: Map<string, CalendarEvent[]>;
}) {
  return (
    <MonthGridFrame
      weeks={weeks}
      renderDay={(day) => {
        const events = eventsByDay.get(day.key) ?? [];
        return (
          <ScheduledMonthDayCell
            key={eventsVersion(events)}
            dayOfMonth={day.date.getDate()}
            dateLabel={formatCalendarDate(toCalendarDay(day.date))}
            inMonth={day.inMonth}
            isToday={day.key === todayKey}
            events={events}
          />
        );
      }}
    />
  );
}

/** The loading calendar uses the loaded frame and cell geometry. Callers pass
    the same buildMonthGrid() weeks and today key as the real calendar. */
export function ScheduledMonthGridSkeleton({
  weeks,
  todayKey,
}: {
  weeks: MonthGridDay[][];
  todayKey: string;
}) {
  return (
    <MonthGridFrame
      weeks={weeks}
      renderDay={(day) => (
        // bg-alpha-3 is the quiet neutral tint used by the loaded today cell.
        <div
          className={cn('flex min-h-28 flex-col gap-1 p-1.5', day.key === todayKey && 'bg-alpha-3')}
        >
          <Skeleton className={cn(dayNumberClass, 'text-transparent')} />
        </div>
      )}
    />
  );
}
