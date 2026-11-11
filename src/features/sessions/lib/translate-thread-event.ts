import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { ChatEvent } from '../types';
import { textFromContent } from './event-content';

const THREAD_STATUSES = {
  'session.thread_status_running': 'running',
  'session.thread_status_idle': 'idle',
  'session.thread_status_rescheduled': 'rescheduled',
  'session.thread_status_terminated': 'terminated',
} as const;

export function translateSessionThreadCreated(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'session.thread_created' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'thread',
    rawType: event.type,
    threadId: event.session_thread_id,
    agentName: event.agent_name,
    at: event.processed_at,
    detail: { sub: 'created' },
  };
}

export function translateThreadStatus(
  event: Extract<
    BetaManagedAgentsStreamSessionEvents,
    {
      type:
        | 'session.thread_status_running'
        | 'session.thread_status_idle'
        | 'session.thread_status_rescheduled'
        | 'session.thread_status_terminated';
    }
  >,
): ChatEvent {
  return {
    id: event.id,
    kind: 'thread',
    rawType: event.type,
    threadId: event.session_thread_id,
    agentName: event.agent_name,
    at: event.processed_at,
    detail: {
      sub: 'status',
      status: THREAD_STATUSES[event.type],
      ...(event.type === 'session.thread_status_idle'
        ? { stopReason: event.stop_reason.type }
        : {}),
    },
  };
}

export function translateAgentThreadMessageSent(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.thread_message_sent' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'thread',
    rawType: event.type,
    threadId: event.to_session_thread_id,
    ...(event.to_agent_name ? { agentName: event.to_agent_name } : {}),
    at: event.processed_at,
    detail: { sub: 'message', direction: 'sent', text: textFromContent(event.content) },
  };
}

export function translateAgentThreadMessageReceived(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.thread_message_received' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'thread',
    rawType: event.type,
    threadId: event.from_session_thread_id,
    ...(event.from_agent_name ? { agentName: event.from_agent_name } : {}),
    at: event.processed_at,
    detail: { sub: 'message', direction: 'received', text: textFromContent(event.content) },
  };
}
