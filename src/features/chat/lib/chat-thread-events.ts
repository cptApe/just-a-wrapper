import type { ChatEvent, ChatThreadDetail } from '@/features/sessions';
import type { ChatItem, ChatState, SubagentEntry, ToolChatItem } from './chat-state';
import { insertItem } from './chat-turns';
import { laneStatusReducer } from './lane-machine';

export function helperLaneIndex(items: ChatItem[], threadId: string | undefined): number {
  if (!threadId) return -1;
  return items.findIndex((item) => item.type === 'subagent' && item.threadId === threadId);
}

/** Create subagent lanes only from thread_created or thread_message events.
 * The primary thread can emit status events, which must not create a phantom subagent lane.
 * Status events update existing subagent lanes; messages append under the same thread id. */
export function foldThreadEvent(
  state: ChatState,
  event: Extract<ChatEvent, { kind: 'thread' }>,
): ChatItem[] {
  const { items } = state;
  const entry = toSubagentEntry(event.id, event.detail, event.at);
  const existing = items.findIndex(
    (item) => item.type === 'subagent' && item.threadId === event.threadId,
  );
  if (existing === -1) {
    // No subagent lane yet, and this is only a status ping — it's the primary thread.
    // Don't materialize a subagent lane from it.
    if (event.detail.sub === 'status') return items;
    // A subagent lane is born only from `created` or `message`, so it opens running.
    const laneTools = items.filter(
      (item): item is ToolChatItem => item.type === 'tool' && item.threadId === event.threadId,
    );
    const lane: ChatItem = {
      type: 'subagent',
      id: event.id,
      threadId: event.threadId,
      agentName: event.agentName,
      status: 'running',
      at: event.at,
      entries: [
        ...laneTools.map((item) => ({ id: item.id, sub: 'tool' as const, item })),
        ...(entry ? [entry] : []),
      ],
    };
    return insertItem(
      {
        ...state,
        items: items.filter((item) => !(item.type === 'tool' && item.threadId === event.threadId)),
      },
      lane,
      event,
    );
  }
  return items.map((item, index) => {
    if (index !== existing || item.type !== 'subagent') return item;
    return withDerivedLaneStatus({
      ...item,
      agentName: item.agentName ?? event.agentName,
      status:
        event.detail.sub === 'status'
          ? laneStatusReducer(item.status, event.detail.status)
          : item.status,
      entries: entry ? [...item.entries, entry] : item.entries,
    });
  });
}

/** A platform idle can mean the helper is parked on an app-owned tool result.
 * Keep that subagent lane visibly live until every nested tool has actually settled. */
export function withDerivedLaneStatus<T extends Extract<ChatItem, { type: 'subagent' }>>(
  lane: T,
): T {
  if (lane.status === 'terminated') return lane;
  if (lane.entries.some((entry) => entry.sub === 'tool' && entry.item.result === undefined)) {
    return { ...lane, status: laneStatusReducer(lane.status, 'running') };
  }
  const latestPlatformStatus = [...lane.entries].reverse().find((entry) => entry.sub === 'status');
  return latestPlatformStatus
    ? { ...lane, status: laneStatusReducer(lane.status, latestPlatformStatus.status) }
    : lane;
}

function toSubagentEntry(
  id: string,
  detail: ChatThreadDetail,
  at: string | undefined,
): SubagentEntry | null {
  switch (detail.sub) {
    case 'created':
      return null;
    case 'status':
      return { id, sub: 'status', status: detail.status, at };
    case 'message':
      return { id, sub: 'message', direction: detail.direction, text: detail.text, at };
  }
}
