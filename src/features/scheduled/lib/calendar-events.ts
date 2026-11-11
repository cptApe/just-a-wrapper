// Paused and event-triggered tasks have no next fire time and stay off calendar days.

import type { AttentionReason, ScheduledGroups, ScheduledItem } from '@/features/tasks/types';
import { dateKey } from './month-grid';

export type CalendarEvent = {
  item: ScheduledItem;
  kind: 'attention' | 'upcoming' | 'history';
  occurredAt: Date;
  /** Set only for kind 'attention' — drives the warning-status treatment. */
  attentionReason?: AttentionReason;
};

export type CalendarEventStatus = 'upcoming' | 'succeeded' | 'failed' | 'stopped' | AttentionReason;

/** The one status for an event, so the mobile agenda and the month grid agree. */
export function calendarEventStatus(event: CalendarEvent): CalendarEventStatus {
  if (event.kind === 'attention') return event.attentionReason ?? 'tool_gate';
  if (event.kind === 'upcoming') return 'upcoming';
  if (event.item.source !== 'session') return 'succeeded';
  return event.item.status ?? (event.item.reviewOutcome === 'not_passed' ? 'failed' : 'succeeded');
}

/** Local-date key → that day's events: needs-you first, then by time of day. */
export function groupEventsByDay(groups: ScheduledGroups): Map<string, CalendarEvent[]> {
  const events: CalendarEvent[] = [
    ...groups.attention.map((item) => ({
      item,
      kind: 'attention' as const,
      occurredAt: item.occurredAt,
      attentionReason: item.reason,
    })),
    ...groups.upcoming.flatMap((item) =>
      item.occurredAt ? [{ item, kind: 'upcoming' as const, occurredAt: item.occurredAt }] : [],
    ),
    ...groups.history.map((item) => ({
      item,
      kind: 'history' as const,
      occurredAt: item.occurredAt,
    })),
  ];

  const byDay = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = dateKey(event.occurredAt);
    const bucket = byDay.get(key) ?? [];
    bucket.push(event);
    byDay.set(key, bucket);
  }
  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => {
      if ((a.kind === 'attention') !== (b.kind === 'attention')) {
        return a.kind === 'attention' ? -1 : 1;
      }
      return a.occurredAt.getTime() - b.occurredAt.getTime();
    });
  }
  return byDay;
}
