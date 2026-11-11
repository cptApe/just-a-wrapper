// Keep upstream event IDs for reconnect deduplication. Explicit classification makes new SDK event
// types fail completeness tests rather than disappear.
import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type {
  BetaManagedAgentsDeltaEvent,
  BetaManagedAgentsStartEvent,
} from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { ChatEvent, EventClass, RelayFrame } from '../types';
import {
  translateSessionError,
  translateSessionStatus,
  translateSessionUsage,
  translateSpanModelRequestEnd,
  translateSpanModelRequestStart,
} from './translate-lifecycle-event';
import {
  translateAgentMessage,
  translateAgentThinking,
  translateUserMessage,
} from './translate-message-event';
import {
  translateAgentThreadMessageReceived,
  translateAgentThreadMessageSent,
  translateSessionThreadCreated,
  translateThreadStatus,
} from './translate-thread-event';
import {
  translateAgentCustomToolUse,
  translateAgentMcpToolResult,
  translateAgentMcpToolUse,
  translateAgentToolResult,
  translateAgentToolUse,
  translateUserCustomToolResult,
  translateUserToolConfirmation,
} from './translate-tool-event';

// An explicit forwarded-type list lets completeness tests detect an unhandled SDK event.
const FORWARDED_EVENT_TYPES = [
  'user.message',
  'agent.message',
  'agent.thinking',
  'agent.tool_use',
  'agent.mcp_tool_use',
  'agent.custom_tool_use',
  'agent.tool_result',
  'agent.mcp_tool_result',
  // The echo of the result OUR dispatcher posted for a custom tool call.
  // Forwarded so the tool card can settle (done/failed) instead of spinning
  // forever — and it's the ONLY source of that result on a history replay.
  'user.custom_tool_result',
  // Forwarded (not noise) so the UI can tell a RESOLVED ask-gate from a pending
  // one after a history replay — without it a re-opened parked session would
  // re-render approve/deny for gates that were already answered.
  'user.tool_confirmation',
  // Billing errors offer top-up; retrying errors render quietly.
  'session.error',
  'session.status_running',
  'session.status_idle',
  'session.status_rescheduled',
  'session.status_terminated',
  'span.model_request_start',
  'span.model_request_end',
  // Usage closes token gaps when helper spans are not cross-posted to the primary stream.
  'session.usage',
  'session.thread_created',
  'session.thread_status_running',
  'session.thread_status_idle',
  'session.thread_status_rescheduled',
  'session.thread_status_terminated',
  'agent.thread_message_received',
  'agent.thread_message_sent',
] as const;

// These events remain mirrored to the event log but do not become chat rows.
const DROPPED_EVENT_TYPES = [
  'span.outcome_evaluation_start',
  'span.outcome_evaluation_ongoing',
  'span.outcome_evaluation_end',
  'session.deleted',
  'session.updated',
  'agent.thread_context_compacted',
  'user.interrupt',
  'user.tool_result',
  'user.define_outcome',
  'system.message',
  // Previews bypass persisted-event translation because they have no stored history or resume
  // cursor.
  'event_start',
  'event_delta',
] as const;

const FORWARD_SET = new Set<string>(FORWARDED_EVENT_TYPES);
const DROP_SET = new Set<string>(DROPPED_EVENT_TYPES);

export function classifyEventType(type: string): EventClass {
  if (FORWARD_SET.has(type)) return 'forward';
  if (DROP_SET.has(type)) return 'drop';
  return 'unknown';
}

// Unknown persisted events remain visible as raw events; completeness tests require a decision for
// each new SDK type.
export function translateEvent(event: BetaManagedAgentsStreamSessionEvents): ChatEvent | null {
  switch (event.type) {
    case 'user.message':
      return translateUserMessage(event);
    case 'agent.message':
      return translateAgentMessage(event);
    // agent.thinking is a progress marker — it carries no content on the stream.
    // Render a distinct, collapsible block.
    case 'agent.thinking':
      return translateAgentThinking(event);
    case 'agent.tool_use':
      return translateAgentToolUse(event);
    case 'agent.mcp_tool_use':
      return translateAgentMcpToolUse(event);
    case 'agent.custom_tool_use':
      return translateAgentCustomToolUse(event);
    case 'agent.tool_result':
      return translateAgentToolResult(event);
    case 'agent.mcp_tool_result':
      return translateAgentMcpToolResult(event);
    case 'user.custom_tool_result':
      return translateUserCustomToolResult(event);
    // The session's record of an answered ask-gate (ours or the relay's
    // auto-approve). The store folds it onto its tool call so a replayed gate
    // renders as resolved, not as a fresh approve/deny prompt.
    case 'user.tool_confirmation':
      return translateUserToolConfirmation(event);
    // Forwarded for its timestamp only: the store pairs it with the matching
    // model_request_end (startId) to compute thinking durations.
    case 'span.model_request_start':
      return translateSpanModelRequestStart(event);
    case 'span.model_request_end':
      return translateSpanModelRequestEnd(event);
    case 'session.usage':
      return translateSessionUsage(event);
    case 'session.error':
      return translateSessionError(event);
    case 'session.status_running':
    case 'session.status_idle':
    case 'session.status_rescheduled':
    case 'session.status_terminated':
      return translateSessionStatus(event);
    case 'session.thread_created':
      return translateSessionThreadCreated(event);
    case 'session.thread_status_running':
    case 'session.thread_status_idle':
    case 'session.thread_status_rescheduled':
    case 'session.thread_status_terminated':
      return translateThreadStatus(event);
    case 'agent.thread_message_sent':
      return translateAgentThreadMessageSent(event);
    case 'agent.thread_message_received':
      return translateAgentThreadMessageReceived(event);
    default:
      // Drop the known-noise types; forward anything genuinely unknown as raw so
      // it still reaches the browser and event log. classifyEventType() is what tells
      // the test which case this is.
      return classifyEventType(event.type) === 'drop' || !('id' in event)
        ? null
        : { id: event.id, kind: 'raw', rawType: event.type };
  }
}

// requires_action is a pause inside a turn, not a terminal idle; only actual completion or
// termination closes the stream.
export function isTerminalStreamEvent(event: BetaManagedAgentsStreamSessionEvents): boolean {
  if (event.type === 'session.status_terminated') return true;
  return event.type === 'session.status_idle' && event.stop_reason.type !== 'requires_action';
}

// Previews have no top-level ID or persisted history, so they bypass deduplication, mirroring,
// billing and status writes.
export function isPreviewEvent(
  event: BetaManagedAgentsStreamSessionEvents,
): event is BetaManagedAgentsStartEvent | BetaManagedAgentsDeltaEvent {
  return event.type === 'event_start' || event.type === 'event_delta';
}

// Ignore unsupported preview variants; the buffered event still supplies complete content.
export function translatePreviewEvent(
  event: BetaManagedAgentsStartEvent | BetaManagedAgentsDeltaEvent,
): Extract<RelayFrame, { type: 'preview_start' | 'preview_delta' }> | null {
  if (event.type === 'event_start') {
    return { type: 'preview_start', eventId: event.event.id, previewType: event.event.type };
  }
  // The SDK documents that accepted enum values can grow at runtime.
  const deltaType: string = event.delta.type;
  if (deltaType !== 'content_delta') return null;
  return {
    type: 'preview_delta',
    eventId: event.event_id,
    index: event.delta.index ?? 0,
    text: event.delta.content.text,
  };
}

export type UnresolvedGate = {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  threadId?: string;
};

// A confirmation or tool result resolves its ask-gate. Reopen remaining gates on attach so parked
// sessions recover without another user message.
export function collectUnresolvedGates(
  events: ReadonlyArray<BetaManagedAgentsStreamSessionEvents>,
): UnresolvedGate[] {
  const pending = new Map<string, Omit<UnresolvedGate, 'toolUseId'>>();
  for (const event of events) {
    switch (event.type) {
      case 'agent.tool_use':
      case 'agent.mcp_tool_use':
        if (event.evaluated_permission === 'ask') {
          pending.set(event.id, {
            toolName: event.name,
            toolInput: event.input,
            ...(event.session_thread_id ? { threadId: event.session_thread_id } : {}),
          });
        }
        break;
      case 'user.tool_confirmation':
        pending.delete(event.tool_use_id);
        break;
      case 'agent.tool_result':
        pending.delete(event.tool_use_id);
        break;
      case 'agent.mcp_tool_result':
        pending.delete(event.mcp_tool_use_id);
        break;
      default:
        break;
    }
  }
  return [...pending].map(([toolUseId, gate]) => ({ toolUseId, ...gate }));
}
