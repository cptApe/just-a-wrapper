import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import { chatStatusSchema } from '@/lib/chat-status';
import type { ChatEvent } from '../types';
import { toRetryStatus, toTokenUsage } from './event-content';

export function translateSpanModelRequestStart(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'span.model_request_start' }>,
): ChatEvent {
  return { id: event.id, kind: 'span_start', rawType: event.type, at: event.processed_at };
}

export function translateSpanModelRequestEnd(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'span.model_request_end' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'usage',
    rawType: event.type,
    usage: toTokenUsage(event.model_usage),
    at: event.processed_at,
    startId: event.model_request_start_id,
  };
}

export function translateSessionUsage(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'session.usage' }>,
): ChatEvent {
  const cacheCreation = event.usage.cache_creation;
  return {
    id: event.id,
    kind: 'usage_snapshot',
    rawType: event.type,
    usage: {
      inputTokens: event.usage.input_tokens ?? 0,
      outputTokens: event.usage.output_tokens ?? 0,
      cacheCreationTokens:
        (cacheCreation?.ephemeral_1h_input_tokens ?? 0) +
        (cacheCreation?.ephemeral_5m_input_tokens ?? 0),
      cacheReadTokens: event.usage.cache_read_input_tokens ?? 0,
    },
    at: event.processed_at,
  };
}

export function translateSessionError(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'session.error' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'error',
    rawType: event.type,
    text: event.error.message,
    errorType: event.error.type,
    retryStatus: toRetryStatus(event.error.retry_status),
    at: event.processed_at,
  };
}

export function translateSessionStatus(
  event: Extract<
    BetaManagedAgentsStreamSessionEvents,
    {
      type:
        | 'session.status_running'
        | 'session.status_idle'
        | 'session.status_rescheduled'
        | 'session.status_terminated';
    }
  >,
): ChatEvent {
  return {
    id: event.id,
    kind: 'status',
    rawType: event.type,
    status: chatStatusSchema.parse(event.type.replace('session.status_', '')),
    ...(event.type === 'session.status_idle' ? { stopReason: event.stop_reason.type } : {}),
    at: event.processed_at,
  };
}
