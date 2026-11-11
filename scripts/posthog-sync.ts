// Dashboards as code: push src/features/admin/analytics/lib/analytics-dashboards.ts into PostHog.
//
//   pnpm posthog:sync            create or update dashboards, insights and alerts
//   pnpm posthog:sync --dry-run  print the plan, write nothing
//   pnpm posthog:sync --no-alerts  skip alerts (they subscribe the key's owner)
//   pnpm posthog:sync --environment development  chart one deploy environment
//
// Idempotent by name: a dashboard or insight with the same name and the managed
// tag is updated in place, anything else is created. Alerts have no tags, so a
// defined alert name is matched on its own: the first (oldest) match is updated
// and any further copy is only reported. Nothing is ever deleted; rename a
// definition and the old object stays behind for a human to remove.
//
// Env (loaded by the pnpm script from the env file): POSTHOG_API_KEY (a personal
// API key with dashboard:write, insight:write, alert:write and user:read for
// the project), POSTHOG_PROJECT_ID, and NEXT_PUBLIC_POSTHOG_UI_HOST (defaults
// to the EU app host).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAnalyticsDefinitions } from '../src/features/admin/analytics/lib/analytics-dashboards.ts';
import {
  type InsightDef,
  MANAGED_TAG,
} from '../src/features/admin/analytics/lib/analytics-query.ts';
import {
  mergeSyncRecord,
  type SyncRecord,
} from '../src/features/admin/analytics/lib/analytics-sync-record.ts';
import { POSTHOG_UI_HOST_DEFAULT } from '../src/features/admin/environment/lib/env-registry.ts';
import {
  type DeploymentEnvironment,
  deploymentEnvironment,
} from '../src/lib/observability-properties.ts';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const dryRun = args.has('--dry-run');
const withAlerts = !args.has('--no-alerts');

function chartEnvironment(argv: string[]): DeploymentEnvironment {
  const flagIndex = argv.findIndex(
    (argument) => argument === '--environment' || argument.startsWith('--environment='),
  );
  const flag = argv.at(flagIndex);
  if (flagIndex === -1 || flag === undefined) return deploymentEnvironment();
  const value =
    flag === '--environment' ? argv[flagIndex + 1] : flag.slice('--environment='.length);
  if (value === 'development' || value === 'preview' || value === 'production') return value;
  console.error('Environment must be development, preview, or production.');
  process.exit(1);
}

const environment = chartEnvironment(rawArgs);
const { dashboards: DASHBOARDS, alerts: ALERTS } = buildAnalyticsDefinitions(environment);

const apiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;
const host = (process.env.NEXT_PUBLIC_POSTHOG_UI_HOST ?? POSTHOG_UI_HOST_DEFAULT).replace(
  /\/$/,
  '',
);

console.log(
  `${dryRun ? 'DRY RUN against' : 'Syncing to'} ${host} project ${projectId ?? 'not set'}, charting ${environment} events`,
);

if (!apiKey || !projectId) {
  console.error(
    'posthog:sync needs POSTHOG_API_KEY (personal API key with dashboard:write, insight:write, alert:write, user:read) and POSTHOG_PROJECT_ID.',
  );
  process.exit(1);
}

const base = `${host}/api/projects/${projectId}`;

type Json = Record<string, unknown>;

async function api<T = Json>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: Json,
): Promise<T> {
  const url = path.startsWith('http') ? path : `${host}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

type Page<T> = { results: T[]; next: string | null };

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = `${base}${path}`;
  while (next) {
    const page: Page<T> = await api<Page<T>>('GET', next);
    out.push(...page.results);
    next = page.next;
  }
  return out;
}

type Named = {
  id: number | string;
  name: string | null;
  /** Insights only: the id their URL uses. */
  short_id?: string;
  tags?: string[];
  deleted?: boolean;
};

/** Insight short ids by name, filled as insights are synced, for deep links. */
const insightShortIds = new Map<string, string>();

function managed<T extends Named>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (row.deleted) continue;
    if (!row.name) continue;
    if (!(row.tags ?? []).includes(MANAGED_TAG)) continue;
    map.set(row.name, row);
  }
  return map;
}

const plan: string[] = [];
function log(line: string): void {
  plan.push(line);
  console.log(line);
}

async function syncDashboards(): Promise<Map<string, Named['id']>> {
  const existing = managed(await listAll<Named>('/dashboards/?limit=100'));
  const ids = new Map<string, Named['id']>();
  for (const def of DASHBOARDS) {
    const body = {
      name: def.name,
      description: def.description,
      tags: [MANAGED_TAG],
      pinned: true,
    };
    const found = existing.get(def.name);
    if (found) {
      log(`dashboard  update  ${def.name} (#${found.id})`);
      if (!dryRun) await api('PATCH', `${base}/dashboards/${found.id}/`, body);
      ids.set(def.name, found.id);
    } else {
      log(`dashboard  create  ${def.name}`);
      if (!dryRun) {
        const created = await api<Named>('POST', `${base}/dashboards/`, body);
        ids.set(def.name, created.id);
      }
    }
  }
  return ids;
}

async function syncInsights(
  dashboardIds: Map<string, Named['id']>,
): Promise<Map<string, Named['id']>> {
  const existing = managed(await listAll<Named>('/insights/?limit=100&saved=true&basic=true'));
  const ids = new Map<string, Named['id']>();
  const seen = new Set<string>();
  for (const dashboard of DASHBOARDS) {
    for (const insight of dashboard.insights) {
      if (seen.has(insight.name)) {
        throw new Error(`insight name used twice: ${insight.name}`);
      }
      seen.add(insight.name);
      const dashboardId = dashboardIds.get(dashboard.name);
      const body = insightBody(insight, dashboardId);
      const found = existing.get(insight.name);
      if (found) {
        log(`insight    update  ${insight.name} (#${found.id})`);
        if (!dryRun) {
          const updated = await api<Named>('PATCH', `${base}/insights/${found.id}/`, body);
          const shortId = updated.short_id ?? found.short_id;
          if (shortId) insightShortIds.set(insight.name, shortId);
        }
        ids.set(insight.name, found.id);
      } else {
        log(`insight    create  ${insight.name}  -> ${dashboard.name}`);
        if (!dryRun) {
          const created = await api<Named>('POST', `${base}/insights/`, body);
          ids.set(insight.name, created.id);
          if (created.short_id) insightShortIds.set(insight.name, created.short_id);
        }
      }
    }
  }
  return ids;
}

function insightBody(insight: InsightDef, dashboardId: Named['id'] | undefined): Json {
  return {
    name: insight.name,
    description: insight.description,
    query: insight.query,
    saved: true,
    tags: [MANAGED_TAG],
    // `dashboards` is marked deprecated in favour of the read-only dashboard_tiles
    // representation, but it is still the one writable way to place an insight
    // on a dashboard through the insights API.
    ...(dashboardId !== undefined ? { dashboards: [dashboardId] } : {}),
  };
}

async function syncAlerts(insightIds: Map<string, Named['id']>): Promise<Map<string, Named['id']>> {
  const ids = new Map<string, Named['id']>();
  const me = await api<{ id: number }>('GET', '/api/users/@me/');
  // Alerts carry no tags, so the name alone is the identity. When a defined
  // name exists more than once the oldest is updated and the rest are reported,
  // never deleted: a same-named alert may be one a person made by hand.
  const rows = (await listAll<Named>('/alerts/?limit=100')).filter((row) => !row.deleted);
  const defined = new Set(ALERTS.map((def) => def.name));
  const existing = new Map<string, Named>();
  // Alert ids are time-ordered UUID strings, so a string sort is oldest-first.
  for (const row of rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!row.name || !defined.has(row.name)) continue;
    if (existing.has(row.name)) {
      log(
        `alert      warn    ${row.name} (#${row.id}) duplicates an earlier alert; left untouched`,
      );
      continue;
    }
    existing.set(row.name, row);
  }
  for (const def of ALERTS) {
    const insightId = insightIds.get(def.insight);
    if (insightId === undefined) {
      if (dryRun) {
        log(
          `alert      create  ${def.name}  (insight "${def.insight}" will exist after a real run)`,
        );
        continue;
      }
      throw new Error(`alert "${def.name}" points at an unknown insight "${def.insight}"`);
    }
    const body: Json = {
      name: def.name,
      insight: insightId,
      subscribed_users: [me.id],
      enabled: true,
      calculation_interval: def.calculationInterval,
      condition: { type: def.condition },
      threshold: {
        name: def.name,
        configuration: {
          type: def.threshold.type,
          bounds: { lower: def.threshold.lower ?? null, upper: def.threshold.upper ?? null },
        },
      },
      config: {
        type: 'TrendsAlertConfig',
        series_index: def.seriesIndex,
        check_ongoing_interval: false,
      },
    };
    const found = existing.get(def.name);
    if (found) {
      log(`alert      update  ${def.name} (#${found.id})`);
      if (!dryRun) await api('PATCH', `${base}/alerts/${found.id}/`, body);
      ids.set(def.name, found.id);
    } else {
      log(`alert      create  ${def.name}`);
      if (!dryRun) {
        const created = await api<Named>('POST', `${base}/alerts/`, body);
        ids.set(def.name, created.id);
      }
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const dashboardIds = await syncDashboards();
  const insightIds = await syncInsights(dashboardIds);
  const alertIds = withAlerts ? await syncAlerts(insightIds) : null;
  console.log(`\n${plan.length} objects ${dryRun ? 'planned' : 'synced'}.`);
  console.log(`Open: ${host}/project/${projectId}/dashboard`);
  if (!dryRun) recordSync(plan.length, dashboardIds, alertIds);
}

// The admin Analytics page shows when the dashboards were last pushed and
// links straight to each dashboard, chart and alert. The record is a committed
// JSON file next to the definitions, so it survives deploys and stays accurate:
// it changes only when someone runs a real sync and commits the result. A run
// that skipped alerts keeps the alert ids of the last full run
// (mergeSyncRecord). The sync itself has already succeeded by the time this
// runs, so a failed write is reported, never turned into a failed sync.
function recordSync(
  objects: number,
  dashboardIds: Map<string, Named['id']>,
  alertIds: Map<string, Named['id']> | null,
): void {
  const file = new URL(
    '../src/features/admin/analytics/lib/analytics-sync-record.json',
    import.meta.url,
  );
  // A record that does not parse (a hand edit, a merge marker) must not block
  // recording forever: read as none and let this run write a fresh one.
  let existing: SyncRecord | null = null;
  try {
    existing = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SyncRecord) : null;
    // eslint-disable-next-line just-a-wrapper/no-silent-catch -- an unreadable record is replaced, and the warning says so
  } catch (error) {
    console.warn(
      `Ignoring the existing sync record (${error instanceof Error ? error.message : String(error)}); writing a fresh one.`,
    );
  }
  try {
    const record = mergeSyncRecord(existing, {
      syncedAt: new Date().toISOString(),
      host,
      // Checked at startup; the module-level const does not narrow in here.
      projectId: String(projectId),
      environment,
      objects,
      dashboards: Object.fromEntries(dashboardIds),
      insights: Object.fromEntries(insightShortIds),
      ...(alertIds
        ? { alerts: Object.fromEntries([...alertIds].map(([name, id]) => [name, String(id)])) }
        : {}),
    });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Recorded the sync in ${fileURLToPath(file)}; commit it with the definitions.`);
    // eslint-disable-next-line just-a-wrapper/no-silent-catch -- the sync succeeded; a record write failure is only reported
  } catch (error) {
    console.warn(
      `Could not write the sync record (${error instanceof Error ? error.message : String(error)}); the sync itself succeeded.`,
    );
  }
}

main().catch((error) => {
  process.exitCode = 1;
  throw error;
});
