'use client';

import { useQueryStates } from 'nuqs';
import { IconCalendar, IconList, IconPlus } from '@/components/icons';
import { PageBody, PageHeader } from '@/components/layouts/page-shell';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { IconToggle, ToolbarDivider, ToolbarSlot } from '@/components/ui/toolbar';
import { CalendarToolbarNav } from '@/features/scheduled/components/calendar-toolbar-nav';
import { ScheduledMonthGridSkeleton } from '@/features/scheduled/components/scheduled-month-grid';
import { SCHEDULED_HEADER_HEIGHT_CLASS } from '@/features/scheduled/constants';
import { buildMonthGrid, dateKey } from '@/features/scheduled/lib/month-grid';
import {
  normalizeScheduledParams,
  scheduledParsers,
} from '@/features/scheduled/lib/scheduled-search-params';
import { cn } from '@/lib/utils';

// Mirrors scheduled-island.tsx: Tasks is the default tab, Runs has a
// list view (default) and a calendar view. The toolbar is the same grid as the
// island so the tabs, month navigation and view toggles do not move on load.
// Lists: the soft container with its 40px header row and three quiet rows;
// the calendar: the soft container with the month grid whose dates are known.
const TAB_OPTIONS = [
  { value: 'tasks' as const, label: 'Tasks' },
  { value: 'runs' as const, label: 'Runs' },
];

const LIST_GRID =
  'grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_2.25rem] items-center gap-x-3';
const RUNS_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] items-center gap-x-3';

export function ScheduledPageSkeleton() {
  const [params] = useQueryStates(scheduledParsers);
  const { tab, view } = normalizeScheduledParams(params);
  const now = new Date();
  const cursor = { year: now.getFullYear(), month: now.getMonth() };
  const calendar = tab === 'runs' && view === 'calendar';
  return (
    <div aria-busy="true" aria-label="Loading scheduled tasks">
      <PageHeader
        title="Scheduled"
        action={
          <>
            <Skeleton className="h-9 w-[180px] rounded-button max-md:min-w-0 max-md:flex-1 md:w-[240px]" />
            <Button size="sm" disabled>
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
            disabled
            onChange={() => undefined}
            label="Scheduled sections"
          />
          {calendar ? (
            <div
              className="col-span-2 row-start-2 flex justify-end md:col-span-1 md:col-start-2 md:row-start-1"
              inert
            >
              <CalendarToolbarNav cursor={cursor} onChange={() => undefined} monthFormat="long" />
            </div>
          ) : null}
          <div className="col-start-2 row-start-1 justify-self-end md:col-start-3" inert>
            <ToolbarSlot visible={tab === 'runs'}>
              {calendar ? (
                <span className="hidden md:contents">
                  <ToolbarDivider />
                </span>
              ) : null}
              <IconToggle label="List view" active={view === 'list'} onClick={() => undefined}>
                <IconList className="size-4" />
              </IconToggle>
              <IconToggle
                label="Calendar view"
                active={view === 'calendar'}
                onClick={() => undefined}
              >
                <IconCalendar className="size-4" />
              </IconToggle>
            </ToolbarSlot>
          </div>
        </div>
      </StickyToolbar>
      <PageBody className="pt-4">
        {calendar ? (
          <div className="overflow-hidden rounded-xl bg-alpha-3">
            <div className="hidden md:block">
              <ScheduledMonthGridSkeleton
                weeks={buildMonthGrid(cursor.year, cursor.month)}
                todayKey={dateKey(now)}
              />
            </div>
          </div>
        ) : (
          <ListSkeleton
            grid={tab === 'runs' ? RUNS_GRID : LIST_GRID}
            columns={tab === 'runs' ? 3 : 4}
          />
        )}
      </PageBody>
    </div>
  );
}

// The soft list container: a 40px header row (real text metrics, muted bars in
// place of the column names) and three rows at the loaded row height.
function ListSkeleton({ grid, columns }: { grid: string; columns: number }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-alpha-3 px-2 pb-2">
      <div className="min-w-0 md:min-w-[620px]">
        <div className={cn(grid, SCHEDULED_HEADER_HEIGHT_CLASS, 'px-3')}>
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className={cn('flex h-[18px] items-center', i > 0 && 'hidden md:flex')}>
              <Skeleton className="h-3 w-12 rounded-sm" />
            </div>
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className={cn(grid, 'min-h-11 px-3 md:min-h-14')}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <div className="flex h-5 items-center">
                <Skeleton className="h-3.5 w-40 rounded-sm" />
              </div>
            </div>
            {Array.from({ length: columns - 1 }, (_, j) => (
              <div
                key={j}
                className={cn('flex h-[18px] items-center', j < columns - 2 && 'hidden md:flex')}
              >
                <Skeleton className="h-3 w-20 rounded-sm" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
