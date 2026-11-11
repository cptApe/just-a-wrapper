'use client';

import Link from 'next/link';
import { useQueryStates } from 'nuqs';
import { useMemo, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { formatCalendarShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';
import { eventTypeLabel, type UsageLogItem } from './usage-log-item';
import {
  LOG_CREDITS_CELL,
  LOG_DAY_CELL,
  LOG_MEMBER_CELL,
  LOG_ROW,
  LOG_TABLE,
  LOG_TASK_CELL,
  LOG_TIME_CELL,
  LOG_TYPE_CELL,
  UsageLogHead,
} from './usage-log-layout';
import { LOG_MAX_EVENTS, LOG_STEP_EVENTS, usagePageParsers } from './usage-params';

// The chronological usage log: every consumption event in the active window,
// newest first, grouped under the same UTC day buckets as the chart (each day
// header restates the day's total, so the log and the bars visibly agree).
// Windowed via the ?events url param — Load more widens the server read inside
// a transition, so the loaded rows stay on screen while the wider window
// streams in (the page's Boundary key excludes ?events).

type DayGroup = { day: string; total: number; rows: UsageLogItem[] };

function groupByDay(items: UsageLogItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.day === item.day) {
      last.rows.push(item);
      last.total += item.credits;
    } else {
      groups.push({ day: item.day, total: item.credits, rows: [item] });
    }
  }
  return groups;
}

export function UsageLog({
  items,
  hasMore,
  showMember,
}: {
  items: UsageLogItem[];
  hasMore: boolean;
  /** Member column renders on the admin whole-workspace view only. */
  showMember: boolean;
}) {
  const [{ events }, setParams] = useQueryStates(usagePageParsers);
  const [isPending, startTransition] = useTransition();
  const groups = useMemo(() => groupByDay(items), [items]);
  const capped = items.length >= LOG_MAX_EVENTS;
  const columns = showMember ? 5 : 4;

  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border py-12 text-center"
        data-testid="usage-log-empty"
      >
        <p className="text-body font-medium">No events in this period</p>
        <p className="text-meta text-muted-foreground">
          Every credit the workspace spends lands here as it happens
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className={LOG_TABLE} aria-busy={isPending} data-testid="usage-log">
          <UsageLogHead showMember={showMember} />
          {groups.map((group) => (
            <tbody key={group.day} data-testid="usage-log-day">
              {/* Day header row: the same UTC bucket as one chart bar, with the
                  day's total in the credits column so the two visibly agree. */}
              <tr>
                <td colSpan={columns - 1} className={`${LOG_DAY_CELL} font-medium`}>
                  {formatCalendarShortDate(group.day)}
                </td>
                <td className={`${LOG_DAY_CELL} text-right tabular-nums`}>
                  {formatCount(group.total)}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.id} className={LOG_ROW}>
                  <td className={`${LOG_TIME_CELL} text-muted-foreground tabular-nums`}>
                    {row.timeLabel}
                  </td>
                  <td className={LOG_TYPE_CELL}>{eventTypeLabel(row.eventType)}</td>
                  <td className={LOG_TASK_CELL}>
                    {row.sessionId ? (
                      <Link
                        href={`/app/task/${row.sessionId}`}
                        className="block truncate hover:underline"
                      >
                        {row.sessionTitle || 'Untitled task'}
                      </Link>
                    ) : (
                      <span className="block truncate text-muted-foreground">No task</span>
                    )}
                  </td>
                  {showMember ? (
                    <td className={`${LOG_MEMBER_CELL} text-muted-foreground`}>
                      {row.member ?? ''}
                    </td>
                  ) : null}
                  <td className={`${LOG_CREDITS_CELL} tabular-nums`}>
                    {row.platformPaid ? (
                      <span className="mr-2 text-meta text-muted-foreground">On us</span>
                    ) : null}
                    {formatCount(row.credits)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="flex items-center gap-3">
        {hasMore && !capped ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              setParams(
                { events: Math.min(events + LOG_STEP_EVENTS, LOG_MAX_EVENTS) },
                { startTransition },
              )
            }
            data-testid="usage-log-more"
          >
            Load more
          </Button>
        ) : null}
        <p className="text-meta font-medium text-muted-foreground tabular-nums">
          {capped && hasMore
            ? `Showing the ${formatCount(LOG_MAX_EVENTS)} most recent events. Narrow the period to see older ones.`
            : `Showing the ${plural(items.length, 'most recent event', 'most recent events')}`}
        </p>
      </div>
    </div>
  );
}
