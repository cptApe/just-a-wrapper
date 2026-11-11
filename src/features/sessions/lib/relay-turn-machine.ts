export type RelayTurn =
  | { phase: 'none' }
  | {
      phase: 'open' | 'interrupted';
      userEventId: string | null;
      startedAt: number;
      firstTokenAt: number | null;
      replies: number;
      modelRequests: number;
      estimated: boolean;
    };
export type RelayTurnAction =
  | { type: 'start'; userEventId: string | null; at: number; estimated: boolean }
  | { type: 'reply' | 'token'; at: number }
  | { type: 'model' | 'interrupt' | 'close' };
export function reduceRelayTurn(state: RelayTurn, action: RelayTurnAction): RelayTurn {
  if (action.type === 'start')
    return {
      phase: 'open',
      userEventId: action.userEventId,
      startedAt: action.at,
      firstTokenAt: null,
      replies: 0,
      modelRequests: 0,
      estimated: action.estimated,
    };
  if (action.type === 'close') return { phase: 'none' };
  if (state.phase === 'none') return state;
  switch (action.type) {
    case 'reply':
      return {
        ...state,
        replies: state.replies + 1,
        firstTokenAt: state.firstTokenAt ?? action.at,
      };
    case 'token':
      return { ...state, firstTokenAt: state.firstTokenAt ?? action.at };
    case 'model':
      return { ...state, modelRequests: state.modelRequests + 1 };
    case 'interrupt':
      return { ...state, phase: 'interrupted' };
  }
}
