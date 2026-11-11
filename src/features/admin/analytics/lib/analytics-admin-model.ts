// Page and markdown twin both read this, so they cannot disagree. Imports carry
// `.ts` so bare Node can load the module under test.

import {
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
} from '@/lib/analytics-events';
import { formatDateTime } from '@/lib/format/format-date';
import { formatNumber, formatPercent } from '@/lib/format/format-number';
import { plural } from '@/lib/format/plural';
import { type AnalyticsDefinitions, buildAnalyticsDefinitions } from './analytics-dashboards';
import type { AlertDef } from './analytics-query';
import type { SyncRecord } from './analytics-sync-record';
import { EVENT_AREAS, EVENT_EXPLANATIONS, type EventArea } from './event-explanations';

export type RuleRow = { label: string; value: string };

type EventRow = { name: AnalyticsEventName; fires: string; tells: string };
export type EventGroup = { area: EventArea; rows: EventRow[] };

/** Registry events grouped in display order. */
export function eventGroups(): EventGroup[] {
  return EVENT_AREAS.map((area) => ({
    area,
    rows: ANALYTICS_EVENT_NAMES.flatMap((name) => {
      const explanation = EVENT_EXPLANATIONS[name];
      return explanation.area === area ? [{ name, ...explanation }] : [];
    }),
  })).filter((group) => group.rows.length > 0);
}

export function eventCount(): number {
  return Object.keys(ANALYTICS_EVENTS).length;
}

export function trackingSummary(): string {
  return `${eventCount()} named events from the server, each sent once when the change is saved. The browser adds page views and caught errors, with no click tracking.`;
}

export function sharedPropertyRows(): RuleRow[] {
  return [
    {
      label: 'Who',
      value:
        'The account id of the person the event belongs to. Billing events belong to the workspace owner.',
    },
    {
      label: 'Workspace',
      value:
        'The workspace it happened in, tagged on every event so any chart can be split per workspace.',
    },
    {
      label: 'Environment',
      value:
        'Every event says whether it came from development, preview, or production. Caught errors carry it too.',
    },
    {
      label: 'Session and task',
      value:
        'The session id and, for scheduled work, the task id, so a number can be traced to a run.',
    },
    {
      label: 'Request',
      value:
        'The request and trace ids the error tracking already uses, so an event and an error from the same request line up.',
    },
  ];
}

export const NEVER_SENT =
  'No message text, prompts, file names, file contents, email addresses, or names are ever sent. Events carry ids, counts, durations, and short fixed labels only.';

export type PostHogLocation = { uiHost: string; projectId: string | null };

export function analyticsDefinitionsForRecord(record: SyncRecord | null): AnalyticsDefinitions {
  return buildAnalyticsDefinitions(record?.environment ?? 'development');
}

type ChartLink = { name: string; href: string | null };

export type DashboardRow = {
  name: string;
  description: string;
  chartCount: number;
  charts: ChartLink[];
  href: string;
};

export type AlertRow = {
  name: string;
  insight: string;
  question: string;
  threshold: string;
  href: string;
};

function projectHref(location: PostHogLocation, path: string): string {
  const host = location.uiHost.replace(/\/$/, '');
  return location.projectId ? `${host}/project/${location.projectId}/${path}` : host;
}

export function dashboardRows(
  location: PostHogLocation,
  record: SyncRecord | null,
  definitions: AnalyticsDefinitions,
): DashboardRow[] {
  return definitions.dashboards.map((dashboard) => {
    const id = record?.dashboards?.[dashboard.name];
    return {
      name: dashboard.name,
      description: dashboard.description,
      chartCount: dashboard.insights.length,
      charts: dashboard.insights.map((insight) => {
        const shortId = record?.insights?.[insight.name];
        return {
          name: insight.name,
          href: shortId && location.projectId ? projectHref(location, `insights/${shortId}`) : null,
        };
      }),
      href: projectHref(location, id === undefined ? 'dashboard' : `dashboard/${id}`),
    };
  });
}

const INTERVAL_WORDS: Record<AlertDef['calculationInterval'], string> = {
  hourly: 'checked every hour',
  daily: 'checked once a day',
  weekly: 'checked once a week',
};

/** A bound with its unit, in the words a person uses: 8000 ms is 8 seconds. */
function formatBound(value: number, unit: AlertDef['unit']): string {
  if (unit === 'milliseconds') {
    if (value >= 1000 && value % 1000 === 0) return plural(value / 1000, 'second');
    return `${formatNumber(value, 3)} milliseconds`;
  }
  return formatNumber(value, 3);
}

/** One plain sentence for the alert's rule, from its definition. */
function alertThresholdSentence(alert: AlertDef): string {
  const { condition, threshold, metric, unit } = alert;
  const interval = INTERVAL_WORDS[alert.calculationInterval];
  if (condition === 'absolute_value') {
    const parts: string[] = [];
    if (threshold.upper !== undefined) parts.push(`above ${formatBound(threshold.upper, unit)}`);
    if (threshold.lower !== undefined) parts.push(`below ${formatBound(threshold.lower, unit)}`);
    return `Fires when ${metric} is ${parts.join(' or ')}, ${interval}.`;
  }
  const direction = condition === 'relative_increase' ? 'up' : 'down';
  const bound = threshold.upper ?? threshold.lower ?? 0;
  const amount =
    threshold.type === 'percentage'
      ? `by more than ${formatPercent(bound * 100)}`
      : `by more than ${formatBound(bound, unit)}`;
  return `Fires when ${metric} is ${direction} ${amount} versus the period before, ${interval}.`;
}

const ALERT_QUESTIONS: Record<string, string> = {
  'Tool failures above 10 in an hour': 'Are tools breaking right now?',
  'Time to first token p95 above 8 seconds': 'Has the agent become slow to start answering?',
  'No signups in a day': 'Did signups stop, or did tracking break?',
  'Errors doubled versus the day before': 'Did a release make things worse?',
};

export function alertRows(
  location: PostHogLocation,
  record: SyncRecord | null,
  definitions: AnalyticsDefinitions,
): AlertRow[] {
  return definitions.alerts.map((alert) => {
    const id = record?.alerts?.[alert.name];
    return {
      name: alert.name,
      insight: alert.insight,
      question: ALERT_QUESTIONS[alert.name] ?? 'Is this number where it should be?',
      threshold: alertThresholdSentence(alert),
      href: projectHref(
        location,
        id === undefined ? 'alerts' : `alerts?alert_type=insights&alert_id=${id}`,
      ),
    };
  });
}

export function dashboardsIntro(definitions: AnalyticsDefinitions): string {
  return `${definitions.dashboards.length} dashboards and ${definitions.alerts.length} alerts, defined in code and pushed to PostHog by name.`;
}

export const SYNC_COMMAND = 'pnpm posthog:sync';

export type AnalyticsStatusInput = {
  /** POSTHOG_PROJECT_KEY: the named events above leave the server. */
  serverKeySet: boolean;
  /** NEXT_PUBLIC_POSTHOG_KEY: page views and caught errors leave the browser. */
  browserKeySet: boolean;
  apiKeySet: boolean;
  projectIdSet: boolean;
  environment: 'development' | 'preview' | 'production';
  record: SyncRecord | null;
};

const ENVIRONMENT_WORDS: Record<AnalyticsStatusInput['environment'], string> = {
  development: 'Development, this machine',
  preview: 'Preview deploy',
  production: 'Production',
};

// The same sentence feeds the admin markdown an agent reads, so it names its zone and keeps one clock.
function formatSyncTime(iso: string): string | null {
  if (Number.isNaN(new Date(iso).getTime())) return null;
  return formatDateTime(iso, { timeZone: 'UTC', timeFormat: '12h' });
}

function chartsShowValue(record: SyncRecord | null): string {
  if (!record) return 'No sync is recorded for this project yet.';
  if (!record.environment) return 'Environment not recorded yet. Run pnpm posthog:sync.';
  const syncTime = formatSyncTime(record.syncedAt);
  return syncTime
    ? `${record.environment} events (synced ${syncTime} UTC).`
    : `${record.environment} events. The sync date is not valid.`;
}

export function statusRows(input: AnalyticsStatusInput): RuleRow[] {
  return [
    {
      label: 'Server events',
      value: input.serverKeySet
        ? 'Present. The named events leave the server.'
        : 'Missing. Set POSTHOG_PROJECT_KEY; until then no named event is sent.',
    },
    {
      label: 'Browser events',
      value: input.browserKeySet
        ? 'Present. Page views and caught errors leave the browser.'
        : 'Missing. Set NEXT_PUBLIC_POSTHOG_KEY and rebuild; until then no page view or browser error is sent.',
    },
    {
      label: 'Dashboards key',
      value: input.apiKeySet
        ? 'Present. The sync command can run from this machine.'
        : 'Missing. Set POSTHOG_API_KEY to run the sync from this machine.',
    },
    {
      label: 'Project',
      value: input.projectIdSet
        ? 'Set. Links on this page open your project.'
        : 'Missing. Set POSTHOG_PROJECT_ID so links open your project.',
    },
    { label: 'Environment', value: ENVIRONMENT_WORDS[input.environment] },
    {
      label: 'Charts show',
      value: chartsShowValue(input.record),
    },
    {
      label: 'Synced objects',
      value: input.record
        ? `${input.record.objects} dashboards, charts and alerts.`
        : 'No synced object count is recorded for this project yet.',
    },
  ];
}

export function statusVerdict(input: AnalyticsStatusInput): {
  tone: 'ready' | 'attention';
  text: string;
} {
  if (!input.serverKeySet && !input.browserKeySet) {
    return { tone: 'attention', text: 'Nothing is being tracked' };
  }
  if (!input.serverKeySet) {
    return { tone: 'attention', text: 'Only the browser is tracked; the named events are off' };
  }
  if (!input.browserKeySet) {
    return {
      tone: 'attention',
      text: 'Named events are tracked; page views and browser errors are off',
    };
  }
  if (!input.record)
    return { tone: 'attention', text: 'Dashboards have not been synced for this project' };
  return { tone: 'ready', text: 'Tracking is on and the dashboards are synced' };
}
