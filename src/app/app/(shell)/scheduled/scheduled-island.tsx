'use client';

import { useQueryStates } from 'nuqs';
import * as React from 'react';
import { IconCalendar, IconList, IconPlus } from '@/components/icons';
import { PageBody, PageHeader } from '@/components/layouts/page-shell';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
import { Segmented } from '@/components/ui/segmented';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { IconToggle, ToolbarDivider, ToolbarSlot } from '@/components/ui/toolbar';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { useScheduledTasks } from '@/features/scheduled/api/use-scheduled-tasks';
import { CalendarToolbarNav } from '@/features/scheduled/components/calendar-toolbar-nav';
import { ScheduleTemplates } from '@/features/scheduled/components/schedule-templates';
import { ScheduledCalendar } from '@/features/scheduled/components/scheduled-calendar';
import { ScheduledList } from '@/features/scheduled/components/scheduled-list';
import { ScheduledRuns } from '@/features/scheduled/components/scheduled-runs';
import { groupSchedules } from '@/features/scheduled/lib/group-schedules';
import type { MonthCursor } from '@/features/scheduled/lib/month-grid';
import {
  normalizeScheduledParams,
  type ScheduledTab,
  scheduledParsers,
} from '@/features/scheduled/lib/scheduled-search-params';
import type { ScheduledGroups } from '@/features/tasks/types';

const TAB_OPTIONS = [
  { value: 'tasks' as const, label: 'Tasks' },
  { value: 'runs' as const, label: 'Runs' },
];

export function ScheduledIsland({
  groups,
  defaultTimezone,
  organizationId,
  hasLiveRunUpdates,
}: {
  groups: ScheduledGroups;
  defaultTimezone: string | null;
  /** Without the Anthropic webhook, finished runs arrive through the recovery sweep. */
  hasLiveRunUpdates: boolean;
  /** Active organizationId — the client cache scope for the Tasks list. */
  organizationId: string;
}) {
  // The Tasks list lives in the React Query cache, seeded from the RSC
  // `upcoming` group. It is the single truth both tabs render from: the Tasks
  // tab reads it directly, and the Calendar tab takes its `upcoming` from here so
  // an optimistic pause/delete/create reflects on the calendar too, with no
  // router.refresh round-trip. `attention` and `history` stay on the RSC prop —
  // no Tasks-tab verb mutates them.
  const upcoming = useScheduledTasks({ organizationId, initialTasks: groups.upcoming });
  const calendarGroups = React.useMemo<ScheduledGroups>(
    () => ({ attention: groups.attention, upcoming, history: groups.history }),
    [groups.attention, groups.history, upcoming],
  );

  const [params, setParams] = useQueryStates(scheduledParsers);
  const { tab, q, view } = normalizeScheduledParams(params);
  const trimmedQ = q.trim();

  function changeTab(next: ScheduledTab) {
    if (next === tab) return;
    void setParams({ tab: next, q: null });
  }

  const taskGroups = React.useMemo(
    () =>
      groupSchedules({
        attention: groups.attention,
        tasks: upcoming,
        query: trimmedQ,
      }),
    [groups.attention, upcoming, trimmedQ],
  );
  const taskCount =
    taskGroups.active.length + taskGroups.paused.length + taskGroups.finished.length;

  // Preserve the chosen month when switching Runs views.
  const [cursor, setCursor] = React.useState<MonthCursor>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  return (
    <>
      <PageHeader
        title="Scheduled"
        action={
          <>
            <SearchField
              value={q}
              onChange={(q) => void setParams({ q })}
              placeholder="Search tasks"
            />
            {/* Opens the #new-schedule hash overlay (registry). size="sm" (h-9)
                so the header CTA matches the search input height; the stored
                timezone rides the `tz` param so the deployment keeps it. */}
            <Button
              size="sm"
              onClick={() =>
                openOverlay(
                  buildOverlayHash(
                    'new-schedule',
                    null,
                    defaultTimezone ? { tz: defaultTimezone } : undefined,
                  ),
                )
              }
            >
              <IconPlus className="size-4" />
              New
            </Button>
          </>
        }
      />
      <StickyToolbar>
        <div className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[auto_1fr_auto]">
          <Segmented
            value={tab}
            options={TAB_OPTIONS}
            onChange={(next) => next && changeTab(next)}
            label="Scheduled sections"
          />
          {tab === 'runs' && view === 'calendar' && (
            <div
              data-scheduled-month-navigation
              className="col-span-2 row-start-2 flex justify-end md:col-span-1 md:col-start-2 md:row-start-1"
            >
              <CalendarToolbarNav cursor={cursor} onChange={setCursor} monthFormat="long" />
            </div>
          )}
          <div className="col-start-2 row-start-1 justify-self-end md:col-start-3">
            <ToolbarSlot visible={tab === 'runs'}>
              {view === 'calendar' && (
                <span className="hidden md:contents">
                  <ToolbarDivider />
                </span>
              )}
              <IconToggle
                label="List view"
                active={view === 'list'}
                onClick={() => void setParams({ view: null })}
              >
                <IconList className="size-4" />
              </IconToggle>
              <IconToggle
                label="Calendar view"
                active={view === 'calendar'}
                onClick={() => void setParams({ view: 'calendar' })}
              >
                <IconCalendar className="size-4" />
              </IconToggle>
            </ToolbarSlot>
          </div>
        </div>
      </StickyToolbar>
      <PageBody className="pt-4">
        {tab === 'runs' && !hasLiveRunUpdates && (
          <p className="mb-4 text-meta font-normal text-muted-foreground">
            Tasks run on schedule. Results appear here the next time someone opens the app or the
            daily check runs. Set ANTHROPIC_WEBHOOK_SECRET to see them right away.
          </p>
        )}
        {tab === 'tasks' ? (
          <div className="flex flex-col gap-10">
            {taskCount === 0 ? (
              trimmedQ !== '' ? (
                <p className="text-meta font-normal text-muted-foreground">
                  No schedules match your search
                </p>
              ) : null
            ) : (
              <ScheduledList groups={taskGroups} />
            )}
            <ScheduleTemplates defaultTimezone={defaultTimezone} />
          </div>
        ) : view === 'list' ? (
          <ScheduledRuns groups={calendarGroups} query={trimmedQ} />
        ) : (
          <ScheduledCalendar groups={calendarGroups} query={trimmedQ} cursor={cursor} />
        )}
      </PageBody>
    </>
  );
}
