'use client';

import { IconDownload01 } from '@/components/icons';
import { SettingsSection } from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
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
import { usagePeriodPillClass } from './usage-period-pill';

// Loading twins for the Usage page, drawn for the common case: an admin on
// This cycle with spend in the period, so the summary, the chart and the
// activity log all render. Static labels render as real text; data pulses.

// Log rows reserved while activity loads.
const ACTIVITY_ROWS = 5;

const VIEW_OPTIONS = [
  { value: 'log', label: 'Log' },
  { value: 'task', label: 'By task' },
  { value: 'member', label: 'By member' },
];

function UsageControlsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex items-center gap-1" aria-label="Usage period">
        {['This cycle', 'Last cycle', 'Custom'].map((label, index) => (
          <span key={label} aria-hidden className={usagePeriodPillClass(index === 0)}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// UsageChart's figure geometry: caption line, the h-48 bar area, the axis line.
function UsageChartSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[18px] items-center justify-end">
        <Skeleton className="h-3 w-36 rounded-sm" />
      </div>
      <Skeleton className="h-48 w-full rounded-md" />
      <div className="flex h-[18px] items-center justify-between">
        <Skeleton className="h-3 w-10 rounded-sm" />
        <Skeleton className="h-3 w-10 rounded-sm" />
        <Skeleton className="h-3 w-10 rounded-sm" />
      </div>
    </div>
  );
}

export function UsageSummaryChartSkeleton({ showRemaining = true }: { showRemaining?: boolean }) {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading usage summary">
      <div className="flex flex-col">
        <SummaryRowSkeleton label="Credits used this period" sublabel emphasis />
        {showRemaining ? <SummaryRowSkeleton label="Remaining balance" sublabel emphasis /> : null}
        <div className="flex flex-col pt-2">
          {['Model usage', 'Voice output', 'Computer runtime', 'Voice input'].map((label) => (
            <SummaryRowSkeleton key={label} label={label} />
          ))}
        </div>
      </div>
      <UsageChartSkeleton />
    </div>
  );
}

function SummaryRowSkeleton({
  label,
  sublabel = false,
  emphasis = false,
}: {
  label: string;
  sublabel?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      data-skeleton={label === 'Credits used this period' ? 'usage-first-row' : undefined}
      // Both sides of a real row have equal line boxes, so its baseline alignment
      // is the same box as items-start; an empty bar has no baseline to align.
      className="flex items-start justify-between gap-4 py-1.5"
    >
      <div className="flex flex-col gap-0.5">
        <span className={emphasis ? 'text-body font-medium' : 'text-meta text-muted-foreground'}>
          {label}
        </span>
        {/* The real sublabel is text-meta font-medium (18px line box); reserve it so the
            emphasis rows don't collapse and shift the block below. */}
        {sublabel ? (
          <div className="flex h-[18px] items-center">
            <Skeleton className="h-3 w-28 rounded-sm" />
          </div>
        ) : null}
      </div>
      <div className={cn('flex items-center', emphasis ? 'h-[22px]' : 'h-[18px]')}>
        <Skeleton className={emphasis ? 'h-3.5 w-16 rounded-sm' : 'h-3 w-12 rounded-sm'} />
      </div>
    </div>
  );
}

function LogBar({ className, end = false }: { className: string; end?: boolean }) {
  return (
    <div className={cn('flex h-[22px] items-center', end && 'justify-end')}>
      <Skeleton className={cn('h-3.5 max-w-full rounded-sm', className)} />
    </div>
  );
}

function noViewChange() {}

// UsageActivity's frame: the real view switcher (inert) and Export CSV over the
// log table, with one day header, a few pulsing event rows and the count line.
export function UsageActivitySkeleton({
  showMember = true,
  showByMember = true,
}: {
  showMember?: boolean;
  showByMember?: boolean;
}) {
  const columns = showMember ? 5 : 4;
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-busy="true"
      aria-label="Loading activity"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div inert className="flex shrink-0">
          <Segmented
            label="View"
            size="sm"
            value="log"
            onChange={noViewChange}
            options={showByMember ? VIEW_OPTIONS : VIEW_OPTIONS.slice(0, 2)}
          />
        </div>
        <Button variant="secondary" size="sm" disabled tabIndex={-1}>
          <IconDownload01 className="size-4" aria-hidden />
          Export CSV
        </Button>
      </div>
      <div className="flex flex-col gap-4">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className={LOG_TABLE}>
            <UsageLogHead showMember={showMember} />
            <tbody>
              <tr>
                <td colSpan={columns - 1} className={LOG_DAY_CELL}>
                  <div className="flex h-[18px] items-center">
                    <Skeleton className="h-3 w-10 rounded-sm" />
                  </div>
                </td>
                <td className={LOG_DAY_CELL}>
                  <div className="flex h-[18px] items-center justify-end">
                    <Skeleton className="h-3 w-6 rounded-sm" />
                  </div>
                </td>
              </tr>
              {Array.from({ length: ACTIVITY_ROWS }, (_, index) => (
                <tr key={index} className={LOG_ROW}>
                  <td className={LOG_TIME_CELL}>
                    <LogBar className="w-15" />
                  </td>
                  <td className={LOG_TYPE_CELL}>
                    <LogBar className="w-32" />
                  </td>
                  <td className={LOG_TASK_CELL}>
                    <LogBar className="w-48" />
                  </td>
                  {showMember ? (
                    <td className={LOG_MEMBER_CELL}>
                      <LogBar className="w-12" />
                    </td>
                  ) : null}
                  <td className={LOG_CREDITS_CELL}>
                    <LogBar className="w-8" end />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex h-[18px] items-center">
          <Skeleton className="h-3 w-56 rounded-sm" />
        </div>
      </div>
    </div>
  );
}

export function UsagePageSkeleton() {
  return (
    <div className="flex flex-col gap-8 pt-8" aria-busy="true" aria-label="Loading usage">
      <UsageControlsSkeleton />
      <UsageSummaryChartSkeleton />
      <SettingsSection title="Activity" divided={false}>
        <UsageActivitySkeleton />
      </SettingsSection>
    </div>
  );
}
