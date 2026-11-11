// The record `pnpm posthog:sync` leaves behind (src/features/admin/analytics/lib/analytics-sync-record.json)
// and the two rules around it. Pure, so the sync script and the admin page's
// tests share one implementation.

import { z } from 'zod';
import type { DeploymentEnvironment } from '@/lib/observability-properties';

export type SyncRecord = {
  syncedAt: string;
  host: string;
  projectId: string;
  environment?: DeploymentEnvironment;
  objects: number;
  dashboards?: Record<string, number | string>;
  /** Insight short ids by name, the id an insight URL uses. */
  insights?: Record<string, string>;
  alerts?: Record<string, string>;
};

export type SyncRecordUpdate = {
  syncedAt: string;
  host: string;
  projectId: string;
  environment: DeploymentEnvironment;
  objects: number;
  dashboards: Record<string, number | string>;
  insights: Record<string, string>;
  /** Omitted when the run skipped alerts (--no-alerts): the stored ids stay. */
  alerts?: Record<string, string>;
};

/**
 * Fold a run into the existing record. Ids merge per key: a run that skipped
 * alerts keeps the alert ids the last full run recorded, and an id a response
 * happened not to return keeps the value the last run recorded, so a chart or
 * dashboard link never silently degrades. A run against a different host or
 * project or environment starts a fresh record, because ids from another
 * chart target mean nothing here.
 */
export function mergeSyncRecord(existing: SyncRecord | null, update: SyncRecordUpdate): SyncRecord {
  const previous =
    existing !== null &&
    existing.host === update.host &&
    existing.projectId === update.projectId &&
    existing.environment === update.environment
      ? existing
      : null;
  const alerts = update.alerts ? { ...previous?.alerts, ...update.alerts } : previous?.alerts;
  return {
    syncedAt: update.syncedAt,
    host: update.host,
    projectId: update.projectId,
    environment: update.environment,
    objects: update.objects,
    dashboards: { ...previous?.dashboards, ...update.dashboards },
    insights: { ...previous?.insights, ...update.insights },
    ...(alerts ? { alerts } : {}),
  };
}

/**
 * The record only counts for the project this deploy points at. Another
 * deploy of the same repo, or a changed env, must not read "synced" with
 * links into somebody else's project. Anything malformed reads as no record.
 */
export function syncRecordForLocation(
  record: unknown,
  location: { uiHost: string; projectId: string | null },
): SyncRecord | null {
  const parsed = z
    .object({
      syncedAt: z.string(),
      host: z.string(),
      projectId: z.string(),
      objects: z.number(),
      environment: z.enum(['development', 'preview', 'production']).optional(),
      dashboards: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
      insights: z.record(z.string(), z.string()).optional(),
      alerts: z.record(z.string(), z.string()).optional(),
    })
    .safeParse(record);
  if (!parsed.success) return null;
  const candidate = parsed.data;
  const sameHost = candidate.host.replace(/\/$/, '') === location.uiHost.replace(/\/$/, '');
  if (!sameHost || location.projectId === null || candidate.projectId !== location.projectId) {
    return null;
  }
  return candidate;
}
