export type SearchListState = { kind: 'closed' } | { kind: 'open'; query: string; index: number };
export type SearchListEvent =
  | { type: 'open'; index: number }
  | { type: 'close' }
  | { type: 'query'; query: string }
  | { type: 'select'; index: number; count: number };
export function searchListReducer(state: SearchListState, event: SearchListEvent): SearchListState {
  switch (event.type) {
    case 'open':
      return { kind: 'open', query: '', index: Math.max(0, event.index) };
    case 'close':
      return { kind: 'closed' };
    case 'query':
      return state.kind === 'closed' ? state : { ...state, query: event.query, index: 0 };
    case 'select':
      return state.kind === 'closed'
        ? state
        : { ...state, index: Math.max(0, Math.min(event.index, event.count - 1)) };
  }
}
