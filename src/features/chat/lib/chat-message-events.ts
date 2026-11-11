import type { ChatEvent } from '@/features/sessions';
import { activityReducer } from './chat-activity-machine';
import type { ChatItem, ChatState } from './chat-state';
import { moveChatStatus } from './chat-status-machine';
import { insertItem, queuedSuffixStart, replaceUserMessage } from './chat-turns';
import { messageDelivery, messageDeliveryReducer } from './message-delivery-machine';

/** Same array when nothing is dropped, so unchanged state keeps its identity. */
function withoutRetryingErrors(items: ChatItem[]): ChatItem[] {
  const kept = items.filter((item) => !(item.type === 'error' && item.retryStatus === 'retrying'));
  return kept.length === items.length ? items : kept;
}

export function reduceMessage(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'message' }>,
): ChatState {
  const fileIds = event.fileRefs?.map((ref) => ref.fileId);
  // The buffered event is the record: it replaces (closes) its preview.
  base.activity = activityReducer(base.activity, { type: 'buffered', eventId: event.id });
  // The send's local anchor already owns its position. A delayed echo must
  // replace it there, even when tools or text have arrived in the meantime.
  const anchorIndex =
    event.role === 'user'
      ? state.items.findIndex(
          (item) =>
            item.type === 'message' &&
            item.localId === item.id &&
            (event.sendId ? item.localId === event.sendId : item.text.trim() === event.text.trim()),
        )
      : -1;
  const anchor = state.items.at(anchorIndex);
  if (anchorIndex !== -1 && anchor?.type === 'message') {
    return replaceUserMessage(base, anchorIndex, {
      ...messageDeliveryReducer(messageDelivery(anchor), event).message,
      ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
    });
  }
  return {
    ...base,
    items: insertItem(
      state,
      {
        type: 'message',
        id: event.id,
        ...(event.sendId ? { localId: event.sendId } : {}),
        role: event.role,
        text: event.text,
        at: event.at,
        ...(fileIds && fileIds.length > 0 ? { fileIds } : {}),
        ...(event.author ? { author: event.author } : {}),
      },
      event,
    ),
  };
}

export function reduceSpanStart(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'span_start' }>,
): ChatState {
  // A request that starts BEFORE messages queue is still answering the
  // current turn; one that starts with a queued suffix will consume its
  // oldest member when the first buffered agent item arrives.
  base.activity = activityReducer(base.activity, {
    type: 'span_start',
    hasQueuedMessages: queuedSuffixStart(state.items) !== state.items.length,
  });
  if (!event.at) return base;
  const spanStarts = new Map(state.spanStarts);
  spanStarts.set(event.id, event.at);
  return { ...base, spanStarts };
}

export function reduceUsage(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'usage' }>,
): ChatState {
  // span.model_request_end: no more deltas are coming — close any preview
  // whose buffered event never arrived (error/interrupt path) and conclude a
  // dangling thinking preview.
  base.activity = activityReducer(base.activity, { type: 'settle' });
  const usage = {
    inputTokens: state.usage.inputTokens + event.usage.inputTokens,
    outputTokens: state.usage.outputTokens + event.usage.outputTokens,
    cacheReadInputTokens: state.usage.cacheReadInputTokens + event.usage.cacheReadInputTokens,
    cacheCreationInputTokens:
      state.usage.cacheCreationInputTokens + event.usage.cacheCreationInputTokens,
  };
  // A thinking marker inside this span [start.at, end.at] gets the span's
  // duration stamped on it (timing data; settled thinking renders nothing).
  const startAt = event.startId ? state.spanStarts.get(event.startId) : undefined;
  if (!startAt || !event.at) return { ...base, usage };
  const durationMs = Date.parse(event.at) - Date.parse(startAt);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { ...base, usage };
  const endAt = event.at;
  return {
    ...base,
    usage,
    items: state.items.map((item) =>
      item.type === 'thinking' &&
      item.durationMs === undefined &&
      item.at !== undefined &&
      item.at >= startAt &&
      item.at <= endAt
        ? { ...item, durationMs }
        : item,
    ),
  };
}

export function reduceStatus(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'status' }>,
): ChatState {
  const moved = moveChatStatus(base, event);
  if (moved === base && event.rawType === 'local.workspace_status') return base;
  if (moved === base)
    return event.status === 'running'
      ? base
      : { ...base, items: withoutRetryingErrors(base.items) };
  const items =
    event.status === 'running' || event.status === 'terminated'
      ? withoutRetryingErrors(state.items).map((item) =>
          item.type === 'error' && item.retryStatus === 'exhausted'
            ? { ...item, retryStatus: 'terminal' as const }
            : item,
        )
      : withoutRetryingErrors(state.items);
  return {
    ...moved,
    items,
    ...(event.status === 'idle' ||
    event.status === 'terminated' ||
    event.status === 'paused_no_credits'
      ? { activity: activityReducer(base.activity, { type: 'settle' }) }
      : {
          activity:
            event.status === 'running'
              ? activityReducer(base.activity, { type: 'run_start' })
              : base.activity,
        }),
  };
}
