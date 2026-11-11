export type SelectionState =
  | { kind: 'empty' }
  | { kind: 'selected'; keys: ReadonlySet<string>; anchor: string | null };
export type SelectionEvent =
  | { type: 'clear' }
  | { type: 'prune' | 'all'; keys: string[] }
  | { type: 'toggle' | 'only'; key: string }
  | { type: 'range'; keys: string[] };
export function selectionReducer(state: SelectionState, event: SelectionEvent): SelectionState {
  const keys = new Set(state.kind === 'selected' ? state.keys : []);
  const anchor = state.kind === 'selected' ? state.anchor : null;
  switch (event.type) {
    case 'clear':
      return { kind: 'empty' };
    case 'all':
      return event.keys.length === 0
        ? { kind: 'empty' }
        : { kind: 'selected', keys: new Set(event.keys), anchor: null };
    case 'prune': {
      const valid = new Set(event.keys);
      const retained = new Set([...keys].filter((key) => valid.has(key)));
      return retained.size === 0
        ? { kind: 'empty' }
        : {
            kind: 'selected',
            keys: retained,
            anchor: anchor !== null && valid.has(anchor) ? anchor : null,
          };
    }
    case 'range':
      return { kind: 'selected', keys: new Set([...keys, ...event.keys]), anchor };
    case 'only':
      return keys.size === 1 && keys.has(event.key)
        ? { kind: 'empty' }
        : { kind: 'selected', keys: new Set([event.key]), anchor: event.key };
    case 'toggle': {
      if (keys.has(event.key)) keys.delete(event.key);
      else keys.add(event.key);
      return keys.size === 0 ? { kind: 'empty' } : { kind: 'selected', keys, anchor: event.key };
    }
  }
}
