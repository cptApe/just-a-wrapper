import type { DeploymentEnvironment } from '@/lib/observability-properties';
import { ALERT_TEMPLATES } from './analytics-alert-templates';
import { DASHBOARD_TEMPLATES } from './analytics-dashboard-templates';
import { type AlertDef, type DashboardDef, environmentOnly } from './analytics-query';

export type AnalyticsDefinitions = {
  dashboards: readonly DashboardDef[];
  alerts: readonly AlertDef[];
};

/** Build the one managed dashboard set for the environment this sync charts. */
export function buildAnalyticsDefinitions(
  environment: DeploymentEnvironment,
): AnalyticsDefinitions {
  const dashboards = DASHBOARD_TEMPLATES.map((dashboard) => ({
    ...dashboard,
    insights: dashboard.insights.map((insight) => ({
      ...insight,
      query: {
        ...insight.query,
        source: {
          ...insight.query.source,
          properties: [environmentOnly(environment), ...insight.query.source.properties],
        },
      },
    })),
  }));
  return { dashboards, alerts: ALERT_TEMPLATES };
}
