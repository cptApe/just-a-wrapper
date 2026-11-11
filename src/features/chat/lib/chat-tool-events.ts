import type { ChatEvent } from '@/features/sessions';
import type { ChatState, ToolChatItem, ToolResult } from './chat-state';
import { helperLaneIndex, withDerivedLaneStatus } from './chat-thread-events';
import { insertItem } from './chat-turns';

export function reduceToolUse(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'tool_use' }>,
): ChatState {
  // A result/confirmation may already be waiting (out-of-order live tail, or
  // this tool_use just paged in behind its already-rendered result).
  const orphanResult = state.orphanResults.get(event.id);
  const orphanConfirmation = state.orphanConfirmations.get(event.id);
  const toolItem: ToolChatItem = {
    type: 'tool',
    id: event.id,
    tool: event.tool,
    name: event.name,
    serverName: event.serverName,
    input: event.input,
    at: event.at,
    evaluatedPermission: event.evaluatedPermission,
    ...(event.confirmation ? { confirmation: event.confirmation } : {}),
    ...(orphanResult ? { result: orphanResult } : {}),
    ...(orphanConfirmation ? { confirmation: orphanConfirmation } : {}),
    ...(event.threadId ? { threadId: event.threadId } : {}),
  };
  const laneIndex = helperLaneIndex(state.items, event.threadId);
  const next: ChatState = {
    ...base,
    items:
      laneIndex === -1
        ? insertItem(state, toolItem, event)
        : state.items.map((item, index) =>
            index === laneIndex && item.type === 'subagent'
              ? withDerivedLaneStatus({
                  ...item,
                  entries: [...item.entries, { id: event.id, sub: 'tool', item: toolItem }],
                })
              : item,
          ),
  };
  if (!orphanResult && !orphanConfirmation) return next;
  const orphanResults = new Map(state.orphanResults);
  orphanResults.delete(event.id);
  const orphanConfirmations = new Map(state.orphanConfirmations);
  orphanConfirmations.delete(event.id);
  return { ...next, orphanResults, orphanConfirmations };
}

export function reduceToolResult(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'tool_result' }>,
): ChatState {
  // Attach the result to the tool item it belongs to; if the matching
  // tool_use hasn't arrived yet, retain the orphan for when it does.
  const result: ToolResult = {
    isError: event.isError,
    text: event.text,
    ...(event.at ? { at: event.at } : {}),
    ...(event.fileRefs && event.fileRefs.length > 0 ? { fileRefs: event.fileRefs } : {}),
  };
  const laneIndex = state.items.findIndex(
    (item) =>
      item.type === 'subagent' &&
      item.entries.some((entry) => entry.sub === 'tool' && entry.item.id === event.toolUseId),
  );
  if (laneIndex !== -1) {
    const lane = state.items.at(laneIndex);
    if (lane?.type === 'subagent') {
      return {
        ...base,
        items: state.items.map((item, index) =>
          index === laneIndex && item.type === 'subagent'
            ? withDerivedLaneStatus({
                ...item,
                entries: item.entries.map((entry) =>
                  entry.sub === 'tool' && entry.item.id === event.toolUseId
                    ? { ...entry, item: { ...entry.item, result } }
                    : entry,
                ),
              })
            : item,
        ),
      };
    }
  }
  if (!state.items.some((item) => item.type === 'tool' && item.id === event.toolUseId)) {
    const orphanResults = new Map(state.orphanResults);
    orphanResults.set(event.toolUseId, result);
    return { ...base, orphanResults };
  }
  return {
    ...base,
    items: state.items.map((item) =>
      item.type === 'tool' && item.id === event.toolUseId ? { ...item, result } : item,
    ),
  };
}

export function reduceToolConfirmation(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'tool_confirmation' }>,
): ChatState {
  // Mark the gated tool call answered; retained as an orphan when its
  // tool_use hasn't arrived (same contract as results).
  const topLevelMatch = state.items.some(
    (item) => item.type === 'tool' && item.id === event.toolUseId,
  );
  const laneMatch = state.items.some(
    (item) =>
      item.type === 'subagent' &&
      item.entries.some((entry) => entry.sub === 'tool' && entry.item.id === event.toolUseId),
  );
  if (!topLevelMatch && !laneMatch) {
    const orphanConfirmations = new Map(state.orphanConfirmations);
    orphanConfirmations.set(event.toolUseId, event.result);
    return { ...base, orphanConfirmations };
  }
  return {
    ...base,
    items: state.items.map((item) =>
      item.type === 'tool' && item.id === event.toolUseId
        ? { ...item, confirmation: event.result }
        : item.type === 'subagent' &&
            item.entries.some((entry) => entry.sub === 'tool' && entry.item.id === event.toolUseId)
          ? {
              ...item,
              entries: item.entries.map((entry) =>
                entry.sub === 'tool' && entry.item.id === event.toolUseId
                  ? { ...entry, item: { ...entry.item, confirmation: event.result } }
                  : entry,
              ),
            }
          : item,
    ),
  };
}
