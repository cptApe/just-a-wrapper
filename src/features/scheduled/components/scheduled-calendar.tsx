'use client';

import { useMemo } from 'react';
import type { ScheduledGroups } from '@/features/tasks/types';
import { type CalendarEvent, groupEventsByDay } from '../lib/calendar-events';
import { buildMonthGrid, dateKey, type MonthCursor } from '../lib/month-grid';
import { ScheduledAgenda } from './scheduled-agenda';
import { ScheduledMonthGrid } from './scheduled-month-grid';

export function ScheduledCalendar({
  groups,
  query,
  cursor,
}: {
  groups: ScheduledGroups;
  query: string;
  cursor: MonthCursor;
}) {
  const eventsByDay = useMemo(() => {
    const byDay = groupEventsByDay(groups);
    const q = query.trim().toLowerCase();
    if (q === '') return byDay;
    const filtered = new Map<string, CalendarEvent[]>();
    for (const [key, events] of byDay) {
      const hits = events.filter((e) => (e.item.title ?? '').toLowerCase().includes(q));
      if (hits.length > 0) filtered.set(key, hits);
    }
    return filtered;
  }, [groups, query]);

  const weeks = buildMonthGrid(cursor.year, cursor.month);
  const todayKey = dateKey(new Date());

  return (
    <section aria-label="Runs calendar">
      <div data-calendar-card className="overflow-hidden rounded-xl bg-alpha-3">
        <div className="md:hidden">
          <ScheduledAgenda weeks={weeks} eventsByDay={eventsByDay} />
        </div>
        <div className="hidden md:block">
          <ScheduledMonthGrid weeks={weeks} todayKey={todayKey} eventsByDay={eventsByDay} />
        </div>
      </div>
    </section>
  );
}
