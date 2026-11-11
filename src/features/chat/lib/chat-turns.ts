import type { ChatEvent } from '@/features/sessions';
import { activityReducer } from './chat-activity-machine';
import type { ChatItem, ChatState, ChatTurn, MessageChatItem, ToolChatItem } from './chat-state';

/** A terminated or credit-paused task runs no tool and takes no decision. */
export function toolsStopped(state: Pick<ChatState, 'status'>): boolean {
  return state.status === 'terminated' || state.status === 'paused_no_credits';
}

/**
 * The relayed ask-gates still awaiting a decision: flagged `'ask'`, no confirmation
 * folded in, and no result (a result implies the gate was answered upstream).
 * Confirmations are forwarded on history replay, so a reopened parked task shows its gate again.
 */
export function selectPendingGates(state: Pick<ChatState, 'items' | 'status'>): ToolChatItem[] {
  if (toolsStopped(state)) return [];
  return selectToolItems(state.items).filter(
    (item) =>
      item.evaluatedPermission === 'ask' &&
      item.confirmation === undefined &&
      item.result === undefined,
  );
}

/** Tool rows across both the primary transcript and nested subagent lanes. */
export function selectToolItems(items: readonly ChatItem[]): ToolChatItem[] {
  const tools: ToolChatItem[] = [];
  for (const item of items) {
    if (item.type === 'tool') tools.push(item);
    if (item.type === 'subagent') {
      for (const entry of item.entries) {
        if (entry.sub === 'tool') tools.push(entry.item);
      }
    }
  }
  return tools;
}

/**
 * The assistant's reply in one turn: every text block in order, joined as paragraphs,
 * with the last block's event id (feedback rows key on it). Null when the turn has no text.
 */
export function selectReply(items: readonly ChatItem[]): { eventId: string; text: string } | null {
  const blocks = items.filter(
    (item): item is MessageChatItem => item.type === 'message' && item.role === 'assistant',
  );
  const last = blocks.at(-1);
  if (!last) return null;
  const text = blocks
    .map((block) => block.text)
    .filter((block) => block.trim().length > 0)
    .join('\n\n');
  return { eventId: last.id, text };
}

/** Group the ordered render model into user-led turns. */
export function groupTurns(items: ChatItem[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const item of items) {
    const startsTurn = item.type === 'message' && item.role === 'user';
    if (startsTurn || turns.length === 0) {
      turns.push({
        key: item.type === 'message' ? (item.localId ?? item.id) : item.id,
        items: [item],
      });
    } else {
      turns.at(-1)?.items.push(item);
    }
  }
  return turns;
}

function isUnprocessedUserMessage(item: ChatItem | undefined): item is MessageChatItem {
  return item?.type === 'message' && item.role === 'user' && item.at === undefined;
}

export function queuedSuffixStart(items: ChatItem[]): number {
  let index = items.length;
  while (index > 0 && isUnprocessedUserMessage(items[index - 1])) index -= 1;
  return index;
}

export function isAgentTurnEvent(event: ChatEvent): boolean {
  return (
    event.rawType.startsWith('agent.') &&
    (event.kind === 'message' ||
      event.kind === 'thinking' ||
      event.kind === 'tool_use' ||
      event.kind === 'thread')
  );
}

/** Insert a renderable event ahead of the queued suffix. Agent turn events
 * graduate its oldest message by landing immediately after that message. */
export function insertItem(state: ChatState, item: ChatItem, event: ChatEvent): ChatItem[] {
  const { items } = state;
  if (isUnprocessedUserMessage(item)) return [...items, item];
  const suffixStart = queuedSuffixStart(items);
  const insertionIndex =
    isAgentTurnEvent(event) && state.activity.burst === 'closed'
      ? Math.min(suffixStart + 1, items.length)
      : suffixStart;
  return [...items.slice(0, insertionIndex), item, ...items.slice(insertionIndex)];
}

/**
 * The trailing user messages the platform has NOT processed yet. A sent
 * user.message's `processed_at` is null while it is "still queued behind
 * earlier events" (docs verbatim) and set once processed; the relay translates
 * it to `at`, so `at === undefined` IS the platform's own queued state. The
 * tail is the suffix of such messages with nothing folded in after them —
 * anything later means the stream moved past the message (the practical
 * graduation signal, since the platform may not re-emit the event when its
 * processed_at flips; a re-delivery that does carry it updates the item in
 * reduceEvent). Empty unless the session is running: settle graduates the
 * whole tail.
 */
export function selectQueuedTail(state: Pick<ChatState, 'items' | 'status'>): MessageChatItem[] {
  if (state.status !== 'running') return [];
  const tail: MessageChatItem[] = [];
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i];
    if (!isUnprocessedUserMessage(item)) break;
    tail.unshift(item);
  }
  return tail;
}

/** Processed echoes graduate out of the queue; an anchor that already has a
 * reply keeps its position. This also handles processed-at updates on replay. */
export function replaceUserMessage(state: ChatState, index: number, updated: ChatItem): ChatState {
  const suffixStart = queuedSuffixStart(state.items);
  if (updated.at === undefined || index < suffixStart) {
    return { ...state, items: state.items.map((item, i) => (i === index ? updated : item)) };
  }
  const withoutUpdated = [...state.items.slice(0, index), ...state.items.slice(index + 1)];
  return {
    ...state,
    activity: activityReducer(state.activity, { type: 'agent_event' }),
    items: [...withoutUpdated.slice(0, suffixStart), updated, ...withoutUpdated.slice(suffixStart)],
  };
}
