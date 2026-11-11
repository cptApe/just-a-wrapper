import 'server-only';
import { analyticsAdminMarkdown } from './analytics-admin-markdown';
import { readAnalyticsStatus, readPostHogLocation } from './read-analytics-status';

export async function analyticsAdminTwin(): Promise<string> {
  return analyticsAdminMarkdown({
    location: readPostHogLocation(),
    status: readAnalyticsStatus(),
  });
}
