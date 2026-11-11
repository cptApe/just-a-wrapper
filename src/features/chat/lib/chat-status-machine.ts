import type { ChatEvent } from '@/features/sessions';
import type { ChatSessionState, ChatState } from './chat-state';

export function moveChatStatus(
  state: ChatState,
  event: Extract<ChatEvent, { kind: 'status' }> & { pausedReason?: ChatState['pausedReason'] },
): ChatState {
  const status = event.status;
  if (state.status === 'terminated') return state;
  const workspace = event.rawType === 'local.workspace_status';
  if (state.status === 'paused_no_credits' && !workspace) return state;
  if (
    workspace &&
    state.status !== 'paused_no_credits' &&
    status !== 'paused_no_credits' &&
    status !== 'terminated'
  )
    return state;
  if (workspace && status === 'requires_input')
    return { ...state, status: 'idle', stopReason: 'requires_action', pausedReason: null };
  if (event.at && state.statusAt && Date.parse(event.at) < Date.parse(state.statusAt)) return state;
  const phase: ChatSessionState =
    status === 'idle'
      ? { status, stopReason: event.stopReason ?? null, pausedReason: null }
      : status === 'paused_no_credits'
        ? { status, stopReason: null, pausedReason: event.pausedReason ?? 'credits' }
        : { status, stopReason: null, pausedReason: null };
  return { ...state, ...phase, statusAt: event.at ?? state.statusAt };
}
