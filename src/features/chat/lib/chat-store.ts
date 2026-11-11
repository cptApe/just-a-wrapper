import type { ChatEvent } from '@/features/sessions';
import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import { activityReducer } from './chat-activity-machine';
import { reduceMessage, reduceSpanStart, reduceStatus, reduceUsage } from './chat-message-events';
import type { ChatState } from './chat-state';
import { foldThreadEvent } from './chat-thread-events';
import { reduceToolConfirmation, reduceToolResult, reduceToolUse } from './chat-tool-events';
import { insertItem, isAgentTurnEvent, replaceUserMessage } from './chat-turns';
import { isCreditStopError } from './credit-stop';
import { messageDelivery, messageDeliveryReducer } from './message-delivery-machine';

/** Local-only events use the same ordered dispatch queue as server events.
 * They never enter the server cursor or seen set. */
export function optimisticSendEvent(
  localId: string,
  text: string,
  {
    queued = false,
    attachments = [],
  }: { queued?: boolean; attachments?: OptimisticComposerAttachment[] } = {},
): ChatEvent & { attachments: OptimisticComposerAttachment[] } {
  return {
    id: localId,
    kind: 'message',
    attachments,
    rawType: queued ? 'local.queued_user_message' : 'local.user_message',
    role: 'user',
    text,
  };
}

export function cancelOptimisticSendEvent(localId: string): ChatEvent {
  return {
    id: localId,
    kind: 'message',
    rawType: 'local.cancel_user_message',
    role: 'user',
    text: '',
  };
}

/** Bridge authoritative workspace status without advancing the relay cursor. */
export function workspaceStatusEvent(
  status: Extract<ChatEvent, { kind: 'status' }>['status'],
): ChatEvent {
  return { id: 'workspace-status', kind: 'status', rawType: 'local.workspace_status', status };
}

/**
 * Fold one event into the state. Returns the SAME reference when the event is a
 * duplicate (already seen) so React can bail out of a re-render cheaply.
 */
export function reduceEvent(
  state: ChatState,
  event: ChatEvent & { attachments?: OptimisticComposerAttachment[] },
): ChatState {
  const local = reduceLocalEvent(state, event);
  if (local) return local;
  if (state.seen.has(event.id)) return reduceReplayedEvent(state, event);
  const seen = new Set(state.seen);
  seen.add(event.id);
  const fileRefCount =
    event.kind === 'message' || event.kind === 'tool_result' ? (event.fileRefs?.length ?? 0) : 0;
  const base: ChatState = {
    ...state,
    seen,
    lastEventId: event.id,
    artifactSignal: fileRefCount > 0 ? state.artifactSignal + 1 : state.artifactSignal,
  };
  if (isAgentTurnEvent(event))
    base.activity = activityReducer(base.activity, { type: 'agent_event' });

  return reduceBufferedEvent(state, base, event);
}

function reduceLocalEvent(
  state: ChatState,
  event: ChatEvent & { attachments?: OptimisticComposerAttachment[] },
): ChatState | null {
  if (event.kind === 'tool_confirmation' && event.rawType === 'local.tool_confirmation')
    return reduceToolConfirmation(state, state, event);
  // Workspace status is authoritative for billing pauses, and is not an
  // Anthropic event: never use its id as the stream's replay cursor.
  if (event.kind === 'status' && event.rawType === 'local.workspace_status') {
    return reduceStatus(state, state, event);
  }
  if (
    event.kind === 'message' &&
    (event.rawType === 'local.user_message' || event.rawType === 'local.queued_user_message')
  ) {
    if (state.items.some((item) => item.type === 'message' && item.localId === event.id))
      return state;
    return {
      ...state,
      activity:
        event.rawType === 'local.queued_user_message'
          ? state.activity
          : activityReducer(state.activity, { type: 'local_send' }),
      items: [
        ...state.items,
        {
          type: 'message',
          id: event.id,
          localId: event.id,
          presentation: event.rawType === 'local.queued_user_message' ? 'stack' : 'thread',
          attachments: event.attachments,
          role: 'user',
          text: event.text,
        },
      ],
    };
  }
  if (event.kind === 'message' && event.rawType === 'local.cancel_user_message') {
    return {
      ...state,
      items: state.items.filter(
        (item) => !(item.type === 'message' && item.localId === event.id && item.id === event.id),
      ),
    };
  }
  return null;
}

function reduceReplayedEvent(state: ChatState, event: ChatEvent): ChatState {
  // Repeated events are no-ops except user messages that gain processed_at.
  // Fold that timestamp in place because it marks the queued message processed.
  // Agent events already carry processed_at when folded.
  if (event.kind === 'message' && event.role === 'user' && event.at !== undefined) {
    const index = state.items.findIndex(
      (item) => item.type === 'message' && item.id === event.id && item.at === undefined,
    );
    const original = state.items.at(index);
    if (index !== -1 && original?.type === 'message') {
      return replaceUserMessage(
        state,
        index,
        messageDeliveryReducer(messageDelivery(original), event).message,
      );
    }
  }
  return state;
}

function reduceBufferedEvent(state: ChatState, base: ChatState, event: ChatEvent): ChatState {
  switch (event.kind) {
    case 'message':
      return reduceMessage(state, base, event);

    case 'thinking':
      return {
        ...base,
        // The buffered thinking event concludes its start-only preview.
        activity: activityReducer(base.activity, { type: 'thinking_buffered' }),
        items: insertItem(state, { type: 'thinking', id: event.id, at: event.at }, event),
      };

    case 'browser_control':
      return reduceBrowserControl(state, base, event);
    case 'tool_use':
      return reduceToolUse(state, base, event);

    case 'tool_result':
      return reduceToolResult(state, base, event);

    case 'tool_confirmation':
      return reduceToolConfirmation(state, base, event);

    case 'span_start':
      return reduceSpanStart(state, base, event);

    case 'usage':
      return reduceUsage(state, base, event);

    case 'usage_snapshot':
      // Cumulative snapshots drive server-side billing reconciliation. The
      // browser only advances its replay cursor for them.
      return base;

    case 'status':
      return reduceStatus(state, base, event);

    case 'error':
      return reduceErrorEvent(state, base, event);
    case 'thread':
      return { ...base, items: foldThreadEvent(state, event) };

    case 'raw':
      // Unknown events
      // advance the cursor + seen-set but render nothing.
      return base;
  }
}

function reduceBrowserControl(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'browser_control' }>,
): ChatState {
  return {
    ...base,
    items: insertItem(
      state,
      {
        type: 'browser_control',
        id: event.id,
        controlledByUser: event.controlledByUser,
        text: event.text,
        at: event.at,
      },
      event,
    ),
  };
}

function reduceErrorEvent(
  state: ChatState,
  base: ChatState,
  event: Extract<ChatEvent, { kind: 'error' }>,
): ChatState {
  // The authoritative workspace pause owns the single billing notice.
  // Apply this during replay too, so old billing errors never return as retries.
  if (isCreditStopError(event.errorType)) return base;
  return {
    ...base,
    items: insertItem(
      state,
      {
        type: 'error',
        id: event.id,
        text: event.text,
        at: event.at,
        errorType: event.errorType,
        retryStatus: event.retryStatus,
      },
      event,
    ),
  };
}
