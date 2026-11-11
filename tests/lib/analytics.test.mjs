// Product analytics the operator reads: each event lands on the right person and workspace in the
// right environment, dashboards chart only events that exist, and links point at this project.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { buildAnalyticsDefinitions } from '../../src/features/admin/analytics/lib/analytics-dashboards.ts';
import {
  mergeSyncRecord,
  syncRecordForLocation,
} from '../../src/features/admin/analytics/lib/analytics-sync-record.ts';
import { ANALYTICS_EVENTS } from '../../src/lib/analytics-events.ts';

const captured = [];
let contextFields;
globalThis.__analyticsTest = { captured, ctx: () => contextFields };
const stub = (body) => ({
  url: `data:text/javascript,${encodeURIComponent(body)}`,
  shortCircuit: true,
});
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './observability')
      return stub(`
        export const captureException = () => {};
        export const initPostHog = () => ({ capture: (m) => globalThis.__analyticsTest.captured.push(m) });
      `);
    if (specifier === './logger')
      return stub('export const logger = () => ({ debug() {}, info() {} });');
    if (specifier === './request-context')
      return stub('export const ctx = () => globalThis.__analyticsTest.ctx();');
    return nextResolve(specifier, context);
  },
});
const { captureEvent, deploymentEnvironment } = await import('../../src/lib/analytics.ts');

test('an event goes to the signed-in user and workspace, explicit identity wins, and no user means no event', () => {
  captured.length = 0;
  captureEvent('workspace:create', { a: 1 });
  assert.equal(captured.length, 0);

  contextFields = { request_id: 'r1', user_id: 'u1', workspace_id: 'w1' };
  captureEvent('session:create', { tier: 'balanced' });
  captureEvent('billing:topup_purchase', {}, { userId: 'owner', workspaceId: 'ws9' });
  contextFields = undefined;
  captureEvent('account:signup_complete', undefined, { userId: 'new-user' });
  assert.deepEqual(
    captured.map((m) => [m.distinctId, m.groups, m.properties.workspace_id]),
    [
      ['u1', { workspace: 'w1' }, 'w1'],
      ['owner', { workspace: 'ws9' }, 'ws9'],
      ['new-user', undefined, undefined],
    ],
  );
  assert.ok(captured.every((m) => m.properties.environment === deploymentEnvironment()));
});

test('the deploy environment comes from Vercel first, then NODE_ENV', () => {
  const previous = { VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV };
  try {
    process.env.VERCEL_ENV = 'preview';
    process.env.NODE_ENV = 'production';
    assert.equal(deploymentEnvironment(), 'preview');
    delete process.env.VERCEL_ENV;
    assert.equal(deploymentEnvironment(), 'production');
    process.env.NODE_ENV = 'test';
    assert.equal(deploymentEnvironment(), 'development');
  } finally {
    if (previous.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.VERCEL_ENV;
    process.env.NODE_ENV = previous.NODE_ENV;
  }
});

test('every dashboard insight charts a registered event in the chosen environment, and every alert has a target', () => {
  for (const environment of ['development', 'production']) {
    const { dashboards, alerts } = buildAnalyticsDefinitions(environment);
    const insights = dashboards.flatMap((dashboard) => dashboard.insights);
    const names = insights.map((insight) => insight.name);
    assert.equal(new Set(names).size, names.length, 'the sync matches insights by name');
    for (const insight of insights) {
      for (const series of insight.query.source.series)
        assert.ok(
          series.event in ANALYTICS_EVENTS || ['$exception', '$pageview'].includes(series.event),
          `${insight.name}: ${series.event}`,
        );
      const filter = insight.query.source.properties?.find((p) => p.key === 'environment');
      assert.deepEqual(filter?.value, [environment], insight.name);
    }
    for (const alert of alerts) {
      const insight = insights.find((candidate) => candidate.name === alert.insight);
      assert.equal(insight?.query.source.kind, 'TrendsQuery', alert.name);
      assert.ok(alert.seriesIndex < insight.query.source.series.length, alert.name);
    }
  }
});

const full = {
  syncedAt: '2026-09-02T22:00:00.000Z',
  host: 'https://eu.posthog.com',
  projectId: '199193',
  environment: 'development',
  objects: 34,
  dashboards: { 'Daily pulse': 1 },
  insights: { 'Signups per day': 'abc123' },
  alerts: { 'No signups in a day': 'alert-1' },
};
const partial = (overrides) => ({
  syncedAt: '2026-09-03T00:00:00.000Z',
  host: full.host,
  projectId: full.projectId,
  environment: full.environment,
  objects: 30,
  dashboards: { Money: 4 },
  insights: {},
  ...overrides,
});

test('a partial sync keeps the links the last full run knew, but never across projects or environments', () => {
  const merged = mergeSyncRecord(full, partial({}));
  assert.deepEqual(merged.dashboards, { 'Daily pulse': 1, Money: 4 });
  assert.deepEqual(merged.insights, full.insights);
  assert.deepEqual(merged.alerts, full.alerts);
  for (const other of [{ projectId: '777' }, { environment: 'production' }]) {
    const fresh = mergeSyncRecord(full, partial({ ...other, dashboards: {} }));
    assert.deepEqual(fresh.dashboards, {});
    assert.equal(fresh.alerts, undefined);
  }
});

test('a sync record counts only for the PostHog host and project this deploy points at', () => {
  const here = { uiHost: 'https://eu.posthog.com', projectId: '199193' };
  assert.deepEqual(syncRecordForLocation(full, here), full);
  assert.deepEqual(
    syncRecordForLocation(full, { ...here, uiHost: 'https://eu.posthog.com/' }),
    full,
  );
  for (const [record, location] of [
    [full, { ...here, projectId: '1' }],
    [full, { ...here, projectId: null }],
    [full, { ...here, uiHost: 'https://us.posthog.com' }],
    [null, here],
    ['junk', here],
    [{ ...full, objects: 'many' }, here],
    [{ ...full, environment: 'staging' }, here],
  ]) {
    assert.equal(syncRecordForLocation(record, location), null);
  }
});
