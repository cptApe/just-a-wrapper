import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { shipLog } from '@/lib/logger';
import { ctx } from '@/lib/request-context';
import { sanitize } from '@/lib/sanitize';
import 'server-only';

// Sampling policy: 100% for tool-use / span / status / error
// events (the audit trail), a 1% sample for high-frequency message/thinking
// chatter so the lake isn't flooded by token-level churn.
const FULL_SAMPLE_PREFIXES = [
  'agent.tool_use',
  'agent.mcp_tool_use',
  'agent.custom_tool_use',
  'span.',
  'session.status_',
  'session.error',
];
const SAMPLE_RATE = 0.01;
const MIRROR_STRING_SAMPLE = 512;

function shouldMirror(type: string): boolean {
  if (FULL_SAMPLE_PREFIXES.some((p) => type.startsWith(p))) return true;
  return Math.random() < SAMPLE_RATE;
}

// Background execution keeps serialization failures from killing the user’s chat stream.
export function mirrorEvent(sessionId: string, event: BetaManagedAgentsStreamSessionEvents): void {
  if (!shouldMirror(event.type)) return;
  // Tool payloads carry file contents, email bodies and credentials: redact them, and keep a sample
  // of long text instead of the whole payload.
  const record = sanitize({ ...event }, { truncateAt: MIRROR_STRING_SAMPLE });
  // Whitelist the request-context fields rather than spreading `...ctx()` raw — the
  // mirror is the audit trail, so only the known attribution keys belong on it, not
  // whatever future code might stash on the ALS store.
  const c = ctx();
  // Without the PostHog key OTLP is a no-op, and the stdout copy obeys LOG_LEVEL.
  shipLog(
    {
      msg: 'sse.mirror',
      request_id: c?.request_id,
      trace_id: c?.trace_id,
      route: c?.route,
      workspace_id: c?.workspace_id,
      organization_id: c?.organization_id,
      user_id: c?.user_id,
      feature: c?.feature,
      op: c?.op,
      session_id: sessionId,
      event_type: event.type,
      event: record,
    },
    { inheritRequestContext: false },
  );
}
