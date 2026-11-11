import type {
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { accrueSessionUsageEvent } from '@/features/billing/api/accrue-session-usage-event';
import 'server-only';
import { accrueSessionEnd } from '@/features/billing/api/accrue-session-end';
// Direct billing/artifact imports avoid cycles through session-resume and unrelated
// save-to-knowledge exports.
import { sweepSessionArtifacts } from '@/features/files/api/sweep-session-artifacts';
// Direct module import (not the notifications barrel) — the relay only needs
// the one connections emitter, and the barrel would drag the feed-auth surface in.
import { notifyIntegrationBroken } from '@/features/notifications/api/notify-task-events';
import type { RelayBackgroundWork } from '@/features/sessions/api/create-background-work';
import { mirrorEvent } from '@/features/sessions/api/mirror';
import { syncSessionStatus } from '@/features/sessions/api/sync-session-status';
import { isTerminalStreamEvent } from '@/features/sessions/lib/relay-translator';
import { statusForEvent } from '@/features/sessions/lib/status-for-event';

// Mirror work runs outside the SSE pump so logging cannot delay delivery.
export function scheduleMirror(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsStreamSessionEvents,
): void {
  work.run('mirror', () => mirrorEvent(sessionId, event));
}

// Only persisted status events can change local state; previews have no IDs. The shared transition
// guard silences webhook/replay duplicates.
export function scheduleStatusSync(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsSessionEvent,
): void {
  const status = statusForEvent(event);
  if (!status) return;
  work.run('sync-status', () =>
    syncSessionStatus({
      kind: 'reconcile',
      anthropicSessionId: sessionId,
      allowFromPause: status === 'terminated',
    }),
  );
}

// Notify broken connections only on the live tail; replaying old authentication failures must not
// notify again.
export function scheduleIntegrationBrokenNotify(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsStreamSessionEvents,
): void {
  if (event.type !== 'session.error') return;
  if (event.error.type !== 'mcp_authentication_failed_error') return;
  const serverName = event.error.mcp_server_name;
  work.run('notify-integration-broken', () =>
    notifyIntegrationBroken({ anthropicSessionId: sessionId, serverName, eventId: event.id }),
  );
}

// Billing uses the same event IDs for browser delivery and server reconciliation.
export function scheduleAccrual(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsStreamSessionEvents,
): void {
  scheduleUsageAccrual(work, sessionId, event);
  scheduleEndAccrual(work, sessionId, event);
}

// Per-request usage is idempotent on event id and needs no provider read.
export function scheduleUsageAccrual(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsStreamSessionEvents,
): void {
  if (event.type !== 'span.model_request_end' && event.type !== 'session.usage') return;
  work.run(
    event.type === 'span.model_request_end'
      ? 'accrue-model-request'
      : 'accrue-usage-reconciliation',
    () => accrueSessionUsageEvent(sessionId, event),
  );
}

// Runtime is the provider's cumulative total billed above a high-water mark, so one terminal idle
// bills what every earlier one would; each call costs a provider read and a row lock.
export function scheduleEndAccrual(
  work: RelayBackgroundWork,
  sessionId: string,
  event: BetaManagedAgentsStreamSessionEvents,
): void {
  if (event.type !== 'session.status_idle' || !isTerminalStreamEvent(event)) return;
  work.run('accrue-session-end', () =>
    accrueSessionEnd(sessionId, { anthropicEventId: event.id, runtime: { kind: 'fetch' } }),
  );
}

// Artifact writes are idempotent by file ID, so reconnects and multiple tabs may safely repeat
// sweeps.
export function scheduleArtifactSweep(
  work: RelayBackgroundWork,
  sessionId: string,
  profile: 'single' | 'relay-settle',
): void {
  work.run('artifact-sweep', () =>
    sweepSessionArtifacts({ anthropicSessionId: sessionId, profile }),
  );
}
