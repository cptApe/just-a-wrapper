'use client';

import Link from 'next/link';
import { useQueryStates } from 'nuqs';
import { useMemo, useState } from 'react';
import { IconDownload01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { DelayedTooltip } from '@/components/ui/tooltip';
import type { UsageByMemberRow, UsageByTaskRow } from '@/features/billing';
import { toCsv } from '@/features/billing/lib/usage-csv';
import { formatCount } from '@/lib/format/format-number';
import { UsageLog } from './usage-log';
import { eventTypeLabel, type UsageLogItem } from './usage-log-item';
import { normalizeUsageView, usagePageParsers } from './usage-params';

type ViewKey = 'log' | 'task' | 'member';

function download(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The Activity content: the same window three ways — the chronological log (the
// record) and the per-task / per-member aggregates — plus the CSV export of the
// active view. The server loads all three datasets, so switching tabs is instant
// (?view is shallow, client-only). This lives INSIDE the data Suspense boundary,
// so it pulses on a period change while the "Activity" heading above it (rendered
// by the shell) stays put.
export function UsageActivity({
  isAdmin,
  showMemberColumn,
  periodApplied,
  byMember,
  byTask,
  logItems,
  logHasMore,
}: {
  isAdmin: boolean;
  showMemberColumn: boolean;
  periodApplied: 'cycle' | 'last' | 'custom';
  byMember: UsageByMemberRow[];
  byTask: UsageByTaskRow[];
  logItems: UsageLogItem[];
  logHasMore: boolean;
}) {
  const [{ view }, setParams] = useQueryStates(usagePageParsers);
  const [sortDesc, setSortDesc] = useState(true);

  // By member lists every colleague, so the tab exists for admins only; a
  // non-admin url carrying ?view=member lands on the nearest aggregate.
  const activeView: ViewKey = normalizeUsageView(view, isAdmin);

  const sortedMembers = useMemo(
    () => [...byMember].sort((a, b) => (sortDesc ? b.used - a.used : a.used - b.used)),
    [byMember, sortDesc],
  );
  const sortedTasks = useMemo(
    () => [...byTask].sort((a, b) => (sortDesc ? b.used - a.used : a.used - b.used)),
    [byTask, sortDesc],
  );

  function exportCsv() {
    // The log CSV covers the LOADED window only (the browser holds no more and a
    // full-period dump would need a new route) — the filename carries the event
    // count and the button's tooltip says "shown" so it can't read as a full-
    // period export. The aggregate CSVs cover the whole period.
    const filename =
      activeView === 'log'
        ? `usage-${periodApplied}-log-${logItems.length}-events.csv`
        : `usage-${periodApplied}-${activeView}.csv`;
    if (activeView === 'member') {
      download(
        filename,
        toCsv(
          ['Member', 'Email', 'Credits used'],
          sortedMembers.map((r) => [r.name, r.email, r.used]),
        ),
      );
    } else if (activeView === 'task') {
      download(
        filename,
        toCsv(
          ['Task', 'Credits used'],
          sortedTasks.map((r) => [r.title ?? 'Untitled task', r.used]),
        ),
      );
    } else {
      download(
        filename,
        toCsv(
          showMemberColumn
            ? ['Time (UTC)', 'Type', 'Task', 'Member', 'Credits used']
            : ['Time (UTC)', 'Type', 'Task', 'Credits used'],
          logItems.map((r) => {
            const base = [r.atIso, eventTypeLabel(r.eventType), r.sessionTitle ?? ''];
            return showMemberColumn ? [...base, r.member ?? '', r.credits] : [...base, r.credits];
          }),
        ),
      );
    }
  }

  const viewOptions: Array<{ value: ViewKey; label: string }> = [
    { value: 'log', label: 'Log' },
    { value: 'task', label: 'By task' },
    ...(isAdmin ? [{ value: 'member' as const, label: 'By member' }] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented<ViewKey>
          label="View"
          size="sm"
          value={activeView}
          onChange={(v) => v && setParams({ view: v })}
          options={viewOptions}
        />
        <DelayedTooltip
          content={
            activeView === 'log'
              ? `Downloads the ${formatCount(logItems.length)} events shown`
              : `Downloads the full ${activeView === 'member' ? 'By member' : 'By task'} breakdown`
          }
          side="bottom"
          delay={300}
        >
          <Button variant="secondary" size="sm" onClick={exportCsv} data-testid="usage-export">
            <IconDownload01 className="size-4" aria-hidden />
            Export CSV
          </Button>
        </DelayedTooltip>
      </div>

      {activeView === 'log' ? (
        <UsageLog items={logItems} hasMore={logHasMore} showMember={showMemberColumn} />
      ) : activeView === 'member' && isAdmin ? (
        <BreakdownTable
          nameHeader="Member"
          sortDesc={sortDesc}
          onToggleSort={() => setSortDesc((d) => !d)}
          rows={sortedMembers.map((r) => ({
            key: r.userId,
            primary: r.name || r.email,
            secondary: r.email,
            used: r.used,
            href: null,
            // Drill into one member: scope the whole page and land on their
            // per-task aggregate.
            onClick: () => setParams({ member: r.userId, view: 'task', events: null }),
          }))}
          testid="usage-by-member"
        />
      ) : (
        <BreakdownTable
          nameHeader="Task"
          sortDesc={sortDesc}
          onToggleSort={() => setSortDesc((d) => !d)}
          rows={sortedTasks.map((r) => ({
            key: r.sessionId,
            primary: r.title || 'Untitled task',
            secondary: null,
            used: r.used,
            href: `/app/task/${r.sessionId}`,
            onClick: null,
          }))}
          testid="usage-by-task"
        />
      )}
    </div>
  );
}

function BreakdownTable({
  nameHeader,
  sortDesc,
  onToggleSort,
  rows,
  testid,
}: {
  nameHeader: string;
  sortDesc: boolean;
  onToggleSort: () => void;
  rows: Array<{
    key: string;
    primary: string;
    secondary: string | null;
    used: number;
    href: string | null;
    onClick: (() => void) | null;
  }>;
  testid: string;
}) {
  return (
    <table className="w-full text-body" data-testid={testid}>
      <thead>
        <tr className="border-b border-border text-meta text-muted-foreground">
          <th className="py-2 text-left font-medium">{nameHeader}</th>
          <th className="py-2 text-right font-medium">
            <button
              type="button"
              onClick={onToggleSort}
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
              data-testid="usage-sort-used"
            >
              Credits used
              <span aria-hidden>{sortDesc ? '↓' : '↑'}</span>
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border/60">
            <td className="max-w-0 py-3 pr-4">
              {row.href ? (
                <Link href={row.href} className="block truncate hover:underline">
                  {row.primary}
                </Link>
              ) : row.onClick ? (
                <button
                  type="button"
                  onClick={row.onClick}
                  className="block max-w-full truncate text-left hover:underline"
                >
                  {row.primary}
                </button>
              ) : (
                <span className="block truncate">{row.primary}</span>
              )}
              {row.secondary ? (
                <span className="block truncate text-meta text-muted-foreground">
                  {row.secondary}
                </span>
              ) : null}
            </td>
            <td className="py-3 text-right tabular-nums">{formatCount(row.used)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
