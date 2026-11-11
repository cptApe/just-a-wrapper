import { activityReducer } from './chat-activity-machine';
import type { ChatState } from './chat-state';

/**
 * Fold a preview_start frame in: an agent.message preview opens the live text
 * buffer; an agent.thinking preview just raises the thinking flag (start-only
 * by contract). A start whose event id has already been folded as a buffered
 * event (reconnect overlap) is a no-op — the record always wins.
 */
export function applyPreviewStart(
  state: ChatState,
  frame: { eventId: string; previewType: 'agent.message' | 'agent.thinking' },
): ChatState {
  if (
    state.status === 'terminated' ||
    state.status === 'paused_no_credits' ||
    state.seen.has(frame.eventId)
  )
    return state;
  if (frame.previewType === 'agent.thinking') {
    return {
      ...state,
      activity: activityReducer(state.activity, { type: 'thinking_start' }),
    };
  }
  return {
    ...state,
    activity: activityReducer(state.activity, { type: 'start', eventId: frame.eventId }),
  };
}

/**
 * Fold one preview_delta text fragment in: append to the block at `index`
 * (create it when new — the docs' accumulator contract). A delta for an
 * already-buffered event id is a no-op; a delta whose start was missed still
 * opens the preview (deltas always carry the previewed id, so nothing is lost).
 */
export function applyPreviewDelta(
  state: ChatState,
  frame: { eventId: string; index: number; text: string },
): ChatState {
  if (
    state.status === 'terminated' ||
    state.status === 'paused_no_credits' ||
    state.seen.has(frame.eventId)
  )
    return state;
  return { ...state, activity: activityReducer(state.activity, { ...frame, type: 'delta' }) };
}

/** The preview's running text, or null when there is nothing to show yet. */
export function selectPreviewText(state: ChatState): string | null {
  if (state.activity.preview.kind === 'idle') return null;
  const text = state.activity.preview.blocks.join('');
  return text.length > 0 ? text : null;
}
