// Managed analytics query shapes shared by dashboard and alert definitions.
import type { AnalyticsEventName } from '@/lib/analytics-events';
import type { DeploymentEnvironment } from '@/lib/observability-properties';

// Tag every managed object so a human can tell code-owned from hand-made in
// the PostHog UI. The sync never touches objects without this tag.
export const MANAGED_TAG = 'just-a-wrapper';

type Interval = 'hour' | 'day' | 'week' | 'month';
type Display =
  | 'ActionsLineGraph'
  | 'ActionsBar'
  | 'BoldNumber'
  | 'ActionsTable'
  | 'ActionsPie'
  | 'ActionsBarValue';
type Math = 'total' | 'dau' | 'sum' | 'avg' | 'median' | 'p90' | 'p95';

// PostHog's event-property filter shape: values are always a list of strings,
// booleans included ('true' / 'false').
type PropertyFilter = { key: string; value: string[]; operator: 'exact'; type: 'event' };

// Every insight selects the environment chosen by the sync. captureEvent puts
// this property on every event.
export function environmentOnly(environment: DeploymentEnvironment): PropertyFilter {
  return {
    key: 'environment',
    value: [environment],
    operator: 'exact',
    type: 'event',
  };
}

// Turns whose start was reconstructed from history mix two clocks; the latency
// views and the latency alert only trust turns the relay timed end to end.
// captureException stamps `code` on the event; TOOL_ACCRUAL_LOST means credits
// were spent and never billed (src/features/tools/api/dispatch.ts).
export const ACCRUAL_LOST_ONLY: PropertyFilter = {
  key: 'code',
  value: ['TOOL_ACCRUAL_LOST'],
  operator: 'exact',
  type: 'event',
};

export const MEASURED_START_ONLY: PropertyFilter = {
  key: 'is_start_estimated',
  value: ['false'],
  operator: 'exact',
  type: 'event',
};

type EventsNode = {
  kind: 'EventsNode';
  event: AnalyticsEventName | '$exception' | '$pageview';
  name?: string;
  custom_name?: string;
  math?: Math;
  math_property?: string;
  properties?: PropertyFilter[];
};

type TrendsQuery = {
  kind: 'TrendsQuery';
  series: EventsNode[];
  interval: Interval;
  dateRange: { date_from: string };
  trendsFilter: { display: Display; formula?: string; showLegend?: boolean };
  breakdownFilter?: { breakdown: string; breakdown_type: 'event'; breakdown_limit?: number };
  properties: PropertyFilter[];
  filterTestAccounts: boolean;
};

type FunnelsQuery = {
  kind: 'FunnelsQuery';
  series: EventsNode[];
  dateRange: { date_from: string };
  funnelsFilter: {
    funnelVizType: 'steps';
    funnelWindowInterval: number;
    funnelWindowIntervalUnit: 'day' | 'hour';
  };
  properties: PropertyFilter[];
  filterTestAccounts: boolean;
};

type InsightQuery = { kind: 'InsightVizNode'; source: TrendsQuery | FunnelsQuery };

export type InsightDef = { name: string; description: string; query: InsightQuery };
export type DashboardDef = { name: string; description: string; insights: InsightDef[] };

export type AlertDef = {
  name: string;
  /** Name of a defined trends insight (alerts monitor one trends series). */
  insight: string;
  seriesIndex: number;
  calculationInterval: 'hourly' | 'daily' | 'weekly';
  condition: 'absolute_value' | 'relative_increase' | 'relative_decrease';
  threshold: { type: 'absolute' | 'percentage'; lower?: number; upper?: number };
  /** What the watched series is, in plain words ("p95 time to first token"). */
  metric: string;
  /** The unit of the threshold bounds, so the rule reads with one. */
  unit: 'count' | 'milliseconds';
};

export function series(
  event: EventsNode['event'],
  opts: Omit<EventsNode, 'kind' | 'event'> = {},
): EventsNode {
  return { kind: 'EventsNode', event, ...opts };
}

export function trend(
  input: Omit<
    TrendsQuery,
    'kind' | 'filterTestAccounts' | 'interval' | 'dateRange' | 'properties'
  > & {
    interval?: Interval;
    dateFrom?: string;
    properties?: PropertyFilter[];
  },
): InsightQuery {
  const { interval = 'day', dateFrom = '-30d', properties = [], ...rest } = input;
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'TrendsQuery',
      interval,
      dateRange: { date_from: dateFrom },
      properties,
      filterTestAccounts: false,
      ...rest,
    },
  };
}

export function funnel(
  events: AnalyticsEventName[],
  windowDays: number,
  dateFrom = '-30d',
): InsightQuery {
  return {
    kind: 'InsightVizNode',
    source: {
      kind: 'FunnelsQuery',
      series: events.map((event) => series(event)),
      dateRange: { date_from: dateFrom },
      funnelsFilter: {
        funnelVizType: 'steps',
        funnelWindowInterval: windowDays,
        funnelWindowIntervalUnit: 'day',
      },
      properties: [],
      filterTestAccounts: false,
    },
  };
}

export const line = { display: 'ActionsLineGraph' } as const;
export const number = { display: 'BoldNumber' } as const;
export const byTool = {
  breakdown: 'tool_name',
  breakdown_type: 'event',
  breakdown_limit: 25,
} as const;
