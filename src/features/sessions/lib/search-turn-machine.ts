export type SearchTurn =
  | { phase: 'empty' }
  | { phase: 'waiting'; users: string[] }
  | { phase: 'replied'; users: string[]; reply: string };
export type SearchTurnAction = { type: 'user' | 'assistant'; text: string } | { type: 'reset' };
export function reduceSearchTurn(
  state: SearchTurn,
  action: SearchTurnAction,
  limit: number,
): SearchTurn {
  switch (action.type) {
    case 'reset':
      return { phase: 'empty' };
    case 'user': {
      const users = [...(state.phase !== 'empty' ? state.users : []), action.text].filter(Boolean);
      const combined = users.join('\n\n');
      return {
        phase: 'waiting',
        users: combined.length > limit ? [combined.slice(-limit)] : users,
      };
    }
    case 'assistant':
      return {
        phase: 'replied',
        users: state.phase !== 'empty' ? state.users : [],
        reply: action.text.slice(-limit),
      };
  }
}
