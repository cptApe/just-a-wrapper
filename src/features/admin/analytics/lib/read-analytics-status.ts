import 'server-only';
import { readEnvironmentKeys } from '@/features/admin/environment/lib/env-status';
import { env } from '@/lib/env';
import { deploymentEnvironment } from '@/lib/observability-properties';
import type { AnalyticsStatusInput, PostHogLocation } from './analytics-admin-model';
import { syncRecordForLocation } from './analytics-sync-record';
import syncRecord from './analytics-sync-record.json';

function keyIsSet(name: string): boolean {
  return readEnvironmentKeys().some((key) => key.name === name && key.isSet);
}

export function readPostHogLocation(): PostHogLocation {
  return { uiHost: env.NEXT_PUBLIC_POSTHOG_UI_HOST, projectId: env.POSTHOG_PROJECT_ID ?? null };
}

export function readAnalyticsStatus(): AnalyticsStatusInput {
  return {
    serverKeySet: keyIsSet('POSTHOG_PROJECT_KEY'),
    browserKeySet: keyIsSet('NEXT_PUBLIC_POSTHOG_KEY'),
    apiKeySet: keyIsSet('POSTHOG_API_KEY'),
    projectIdSet: Boolean(env.POSTHOG_PROJECT_ID),
    environment: deploymentEnvironment(),
    // The committed record only counts when it names this deploy's project.
    record: syncRecordForLocation(syncRecord, readPostHogLocation()),
  };
}
