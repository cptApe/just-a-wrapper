import type { BetaManagedAgentsStreamSessionEvents } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { ChatEvent } from '../types';
import {
  extractFileRefs,
  textFromContent,
  threadIdField,
  toolResultTextFromContent,
} from './event-content';

export function translateAgentToolUse(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.tool_use' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'tool_use',
    rawType: event.type,
    tool: 'builtin',
    name: event.name,
    input: event.input,
    at: event.processed_at,
    evaluatedPermission: event.evaluated_permission,
    ...threadIdField(event),
  };
}

export function translateAgentMcpToolUse(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.mcp_tool_use' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'tool_use',
    rawType: event.type,
    tool: 'mcp',
    name: event.name,
    serverName: event.mcp_server_name,
    input: event.input,
    at: event.processed_at,
    evaluatedPermission: event.evaluated_permission,
    ...threadIdField(event),
  };
}

export function translateAgentCustomToolUse(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.custom_tool_use' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'tool_use',
    rawType: event.type,
    tool: 'custom',
    name: event.name,
    input: event.input,
    at: event.processed_at,
    ...(event.session_thread_id ? { threadId: event.session_thread_id } : {}),
  };
}

// Builtin and MCP tool results use different upstream call-ID fields; normalize them so the store
// can settle either tool card.
export function translateAgentToolResult(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.tool_result' }>,
): ChatEvent {
  const fileRefs = extractFileRefs(event.content);
  return {
    id: event.id,
    kind: 'tool_result',
    rawType: event.type,
    toolUseId: event.tool_use_id,
    isError: event.is_error === true,
    text: toolResultTextFromContent(event.content),
    at: event.processed_at,
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
    ...threadIdField(event),
  };
}

export function translateAgentMcpToolResult(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'agent.mcp_tool_result' }>,
): ChatEvent {
  const fileRefs = extractFileRefs(event.content);
  return {
    id: event.id,
    kind: 'tool_result',
    rawType: event.type,
    toolUseId: event.mcp_tool_use_id,
    isError: event.is_error === true,
    text: textFromContent(event.content),
    at: event.processed_at,
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
    ...threadIdField(event),
  };
}

export function translateUserCustomToolResult(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'user.custom_tool_result' }>,
): ChatEvent {
  const fileRefs = extractFileRefs(event.content);
  return {
    id: event.id,
    kind: 'tool_result',
    rawType: event.type,
    toolUseId: event.custom_tool_use_id,
    isError: event.is_error === true,
    text: textFromContent(event.content),
    at: event.processed_at ?? undefined,
    ...(fileRefs.length > 0 ? { fileRefs } : {}),
    ...(event.session_thread_id ? { threadId: event.session_thread_id } : {}),
  };
}

export function translateUserToolConfirmation(
  event: Extract<BetaManagedAgentsStreamSessionEvents, { type: 'user.tool_confirmation' }>,
): ChatEvent {
  return {
    id: event.id,
    kind: 'tool_confirmation',
    rawType: event.type,
    toolUseId: event.tool_use_id,
    result: event.result,
    at: event.processed_at ?? undefined,
    ...(event.session_thread_id ? { threadId: event.session_thread_id } : {}),
  };
}
