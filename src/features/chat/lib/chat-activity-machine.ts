export type ChatActivity = {
  preview: { kind: 'idle' } | { kind: 'streaming'; eventId: string; blocks: readonly string[] };
  thinking: 'idle' | 'streaming';
  burst: 'closed' | 'open';
};
export type ActivityAction =
  | { type: 'settle' }
  | { type: 'agent_event' | 'local_send' | 'run_start' | 'thinking_start' | 'thinking_buffered' }
  | { type: 'span_start'; hasQueuedMessages: boolean }
  | { type: 'start'; eventId: string }
  | { type: 'buffered'; eventId: string }
  | { type: 'delta'; eventId: string; index: number; text: string };
export function initialActivity(): ChatActivity {
  return { preview: { kind: 'idle' }, thinking: 'idle', burst: 'closed' };
}
export function activityReducer(state: ChatActivity, action: ActivityAction): ChatActivity {
  switch (action.type) {
    case 'settle':
      return initialActivity();
    case 'agent_event':
      return { ...state, burst: 'open' };
    case 'span_start':
      return { ...state, burst: action.hasQueuedMessages ? 'closed' : 'open' };
    case 'local_send':
    case 'run_start':
      return { ...state, burst: 'closed' };
    case 'thinking_start':
      return { ...state, thinking: 'streaming' };
    case 'thinking_buffered':
      return { ...state, thinking: 'idle' };
    case 'start':
      return { ...state, preview: { kind: 'streaming', eventId: action.eventId, blocks: [] } };
    case 'buffered':
      return state.preview.kind === 'streaming' && state.preview.eventId === action.eventId
        ? { ...state, preview: { kind: 'idle' } }
        : state;
    case 'delta': {
      const blocks =
        state.preview.kind === 'streaming' && state.preview.eventId === action.eventId
          ? [...state.preview.blocks]
          : [];
      while (blocks.length <= action.index) blocks.push('');
      blocks[action.index] += action.text;
      return { ...state, preview: { kind: 'streaming', eventId: action.eventId, blocks } };
    }
  }
}
