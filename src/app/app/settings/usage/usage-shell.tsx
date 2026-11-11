import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsSection } from '@/components/settings/settings-section';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import {
  getUsageByMember,
  getUsageByTask,
  getUsageByType,
  getUsageContext,
  getUsageEvents,
  getUsageMemberIdentity,
  getUsageTimeSeries,
} from '@/features/billing';
import { resolveUsageGating } from '@/features/billing/lib/usage-gating';
import {
  countDays,
  densifyDays,
  lastCycleAvailable,
  MAX_DENSE_DAYS,
  resolveUsageWindow,
  toDayString,
} from '@/features/billing/lib/usage-period';
import { getDisplayPreferences } from '@/features/preferences/api/get-preferences';
import { type Caller, findCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { withRequestContext } from '@/lib/request-context';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { UsageActivity } from './usage-activity';
import { UsageChart } from './usage-chart';
import { MemberFilterChip, UsageControls } from './usage-controls';
import { toUsageLogItem } from './usage-log-item';
import { clampEventsLimit } from './usage-params';
import { UsageActivitySkeleton, UsageSummaryChartSkeleton } from './usage-skeleton';
import { UsageSummary } from './usage-summary';

type UsageParams = {
  period: 'cycle' | 'last' | 'custom';
  from: string | null;
  to: string | null;
  member: string | null;
  events: number;
};

// Keep period and member controls outside data Suspense boundaries.
// Window-keyed summary/chart and activity regions reload independently
// while the frame and controls stay mounted and interactive.
export async function UsageShell({ params }: { params: UsageParams }) {
  const shell = await withRequestContext({ route: 'settings-usage-page' }, async () => {
    let membership: Caller | null;
    try {
      membership = await findCaller(await headers());
    } catch (error) {
      if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
        redirect(await loginRedirectUrl());
      throw error;
    }
    if (!membership) redirect('/app');
    const organizationId = membership.organizationId;
    const isAdmin = roleIsAtLeast(membership.role, 'admin');

    const ctx = await getUsageContext(organizationId);
    if (!ctx) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace for active organization', {
        organizationId,
      });
    }

    // Gating: an admin may filter to any member via ?member; everyone else is
    // pinned to their own usage. The By member breakdown lists colleagues, so it
    // is ADMIN-ONLY and never fetched for a plain member.
    const gating = resolveUsageGating({
      isAdmin,
      ownUserId: membership.userId,
      requestedMember: params.member,
    });

    const window = resolveUsageWindow({
      period: params.period,
      from: params.from,
      to: params.to,
      creditResetAt: ctx.creditResetAt,
      workspaceCreatedAt: ctx.createdAt,
    });

    return {
      isAdmin,
      organizationId,
      workspaceId: ctx.workspaceId,
      creditBalance: ctx.creditBalance,
      showRemaining: gating.showRemaining,
      showByMember: gating.showByMember,
      effectiveUserId: gating.effectiveUserId,
      requestedMember: gating.requestedMember,
      lastCycleAvailable: lastCycleAvailable(ctx.creditResetAt),
      windowFrom: window.from,
      windowTo: window.to,
      periodApplied: window.period,
      fromDay: toDayString(window.from),
      toDay: toDayString(window.to),
      eventsLimit: clampEventsLimit(params.events),
    };
  });

  // Keyed on the window (NOT ?view / ?events, which switch/stream client-side),
  // so a period/member change remounts the data regions to their skeletons while
  // the controls above keep their DOM and state.
  const dataKey = `${params.period}:${params.from ?? ''}:${params.to ?? ''}:${params.member ?? ''}`;

  // The member column shows only on the admin whole-workspace view; any member
  // filter (requested, whether or not its display name resolves) scopes the page
  // to one member and hides it. Deriving this from the request — not the awaited
  // chip identity — keeps both data loaders off the identity lookup's critical
  // path: the lookup runs in parallel and only feeds the chip's own boundary.
  const requestedMember = shell.requestedMember;
  const showMemberColumn = shell.isAdmin && requestedMember === null;
  const filterIdentity = requestedMember
    ? withRequestContext({ route: 'settings-usage-page' }, async () =>
        getUsageMemberIdentity(shell.organizationId, requestedMember),
      )
    : Promise.resolve(null);

  return (
    <div className="flex flex-col gap-8 pt-8">
      <UsageControls lastCycleAvailable={shell.lastCycleAvailable}>
        {requestedMember ? (
          <Boundary loading={null} error={null}>
            <MemberFilterChip identity={filterIdentity} />
          </Boundary>
        ) : null}
      </UsageControls>

      <Boundary
        key={`summary:${dataKey}`}
        loading={<UsageSummaryChartSkeleton showRemaining={shell.showRemaining} />}
        error={<UsageError />}
      >
        <UsageSummaryLoader
          workspaceId={shell.workspaceId}
          from={shell.windowFrom}
          to={shell.windowTo}
          effectiveUserId={shell.effectiveUserId}
          creditBalance={shell.creditBalance}
          showRemaining={shell.showRemaining}
          fromDay={shell.fromDay}
          toDay={shell.toDay}
        />
      </Boundary>

      <SettingsSection title="Activity" divided={false}>
        <Boundary
          key={`activity:${dataKey}`}
          loading={
            <UsageActivitySkeleton showMember={showMemberColumn} showByMember={shell.isAdmin} />
          }
          error={<UsageError />}
        >
          <UsageActivityLoader
            workspaceId={shell.workspaceId}
            from={shell.windowFrom}
            to={shell.windowTo}
            effectiveUserId={shell.effectiveUserId}
            isAdmin={shell.isAdmin}
            showByMember={shell.showByMember}
            showMemberColumn={showMemberColumn}
            periodApplied={shell.periodApplied}
            eventsLimit={shell.eventsLimit}
          />
        </Boundary>
      </SettingsSection>
    </div>
  );
}

// Summary + chart data region: fetched against the resolved window and pulsing as
// one unit. The six-row summary always renders (0s when a type had no spend); the
// chart is drawn only when there is spend to plot.
async function UsageSummaryLoader({
  workspaceId,
  from,
  to,
  effectiveUserId,
  creditBalance,
  showRemaining,
  fromDay,
  toDay,
}: {
  workspaceId: string;
  from: Date;
  to: Date;
  effectiveUserId: string | null;
  creditBalance: number;
  showRemaining: boolean;
  fromDay: string;
  toDay: string;
}) {
  return withRequestContext({ route: 'settings-usage-page' }, async () => {
    const [sparseSeries, byType] = await Promise.all([
      getUsageTimeSeries({ workspaceId, from, to, userId: effectiveUserId }),
      getUsageByType({ workspaceId, from, to, userId: effectiveUserId }),
    ]);

    const series = densifyDays(sparseSeries, from, to);
    // The headline total sums the UNCAPPED rows, not the MAX_DENSE_DAYS chart
    // array, so a window longer than the cap never undercounts the number.
    const usedThisPeriod = sparseSeries.reduce((sum, d) => sum + d.used, 0);
    const chartTruncated = countDays(from, to) > MAX_DENSE_DAYS;

    return (
      <div className="flex flex-col gap-8">
        <UsageSummary
          usedThisPeriod={usedThisPeriod}
          creditBalance={creditBalance}
          showRemaining={showRemaining}
          byType={byType}
          fromDay={fromDay}
          toDay={toDay}
        />
        {usedThisPeriod > 0 ? <UsageChart series={series} truncated={chartTruncated} /> : null}
      </div>
    );
  });
}

// Activity data region: the log + aggregates for the window. Empty window → the
// dashed empty state under the (persistent) Activity heading.
async function UsageActivityLoader({
  workspaceId,
  from,
  to,
  effectiveUserId,
  isAdmin,
  showByMember,
  showMemberColumn,
  periodApplied,
  eventsLimit,
}: {
  workspaceId: string;
  from: Date;
  to: Date;
  effectiveUserId: string | null;
  isAdmin: boolean;
  showByMember: boolean;
  showMemberColumn: boolean;
  periodApplied: 'cycle' | 'last' | 'custom';
  eventsLimit: number;
}) {
  return withRequestContext({ route: 'settings-usage-page' }, async () => {
    // The log is windowed via ?events (clamped in the shell); fetching one row
    // past the window is how we learn whether older events exist.
    const [byMember, byTask, logRows, { timeFormat }] = await Promise.all([
      showByMember ? getUsageByMember({ workspaceId, from, to }) : Promise.resolve([]),
      getUsageByTask({ workspaceId, from, to, userId: effectiveUserId }),
      getUsageEvents({
        workspaceId,
        from,
        to,
        userId: effectiveUserId,
        limit: eventsLimit + 1,
      }),
      getDisplayPreferences(await headers()),
    ]);

    if (logRows.length === 0) {
      return (
        <div
          className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border py-16 text-center"
          data-testid="usage-empty"
        >
          <p className="text-body font-medium">No usage in this period</p>
          <p className="text-meta text-muted-foreground">
            Pick another period, or start a chat and every credit spent shows up here
          </p>
        </div>
      );
    }

    // Display-ready strings mapped server-side (UTC buckets, the reader's clock): the island
    // renders them verbatim.
    const logItems = logRows.slice(0, eventsLimit).map((row) => toUsageLogItem(row, timeFormat));
    const logHasMore = logRows.length > eventsLimit;

    return (
      <UsageActivity
        isAdmin={isAdmin}
        showMemberColumn={showMemberColumn}
        periodApplied={periodApplied}
        byMember={byMember}
        byTask={byTask}
        logItems={logItems}
        logHasMore={logHasMore}
      />
    );
  });
}

export function UsageError() {
  return (
    <ErrorState
      title="Couldn’t load usage"
      message="Something went wrong reading the workspace usage. Reload the page to try again."
    />
  );
}
