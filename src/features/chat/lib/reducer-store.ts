export function createReducerStore<State, Action>(
  initial: State,
  reduce: (state: State, action: Action) => State,
) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(action: Action) {
      const next = reduce(state, action);
      if (next === state) return false;
      state = next;
      for (const listener of listeners) listener();
      return true;
    },
  };
}
