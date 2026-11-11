import { formatAdminPrompt } from '@/lib/admin-prompt';
import { eventCount, SYNC_COMMAND } from './analytics-admin-model';

export function analyticsAdminPromptText(): string {
  return formatAdminPrompt({
    where:
      'src/lib/analytics-events.ts (the event registry), src/features/admin/analytics/lib/event-explanations.ts (its plain-words explanation), src/features/admin/analytics/lib/analytics-dashboards.ts (the charts and alerts)',
    what: `Add one tracked event. There are ${eventCount()} today. Ask me what moment it should mark, then: add it to the registry with a category:object_action name and a description that says exactly when it fires; add its plain-words explanation; call captureEvent once at the place in a feature api where that moment becomes durable (after the database write, behind any idempotency guard); and add an insight for it to a dashboard.`,
    guardrails: [
      'Capture on the server, once, after the write; never on the client for something the server already knows',
      'Never send message text, prompts, file names, email addresses, or names; ids, counts, durations, and fixed labels only',
      'Reuse the identity argument for hooks and webhooks that have no signed-in user',
      'Do not edit dashboards in PostHog by hand; change the definition file and run the sync',
    ],
    verify: [
      'pnpm verify (the registry test fails if the event has no capture call site)',
      `${SYNC_COMMAND} --dry-run, then ${SYNC_COMMAND}, and commit the sync record it writes`,
      'Reload /admin/analytics and check the event and the chart are listed',
    ],
  });
}
