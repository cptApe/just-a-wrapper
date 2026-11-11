'use client';
import { useState, useSyncExternalStore } from 'react';
import { createReducerStore } from '../lib/reducer-store';

/**
 * A reducer whose state can also be read synchronously (`getSnapshot`) and whose `dispatch`
 * returns whether the state moved. Use plain `useReducer` when nothing needs either. The store
 * lives as long as the component, so state that belongs to one session needs the component
 * keyed by that session (ChatView keys itself).
 */
export function useMachineStore<State, Event>(
  initial: State | (() => State),
  reduce: (state: State, event: Event) => State,
) {
  const [store] = useState(() =>
    createReducerStore(initial instanceof Function ? initial() : initial, reduce),
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { state, ...store };
}
