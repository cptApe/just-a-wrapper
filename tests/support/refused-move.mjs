/** Reducer-store contract: a refused move returns the same state, so dispatch reports false and notifies no one. */

import assert from 'node:assert/strict';
import { createReducerStore } from '../../src/features/chat/lib/reducer-store.ts';

export function assertRefusedMove(reducer, state, action) {
  assert.equal(reducer(state, action), state, `${action.type} must keep the same state`);
  const store = createReducerStore(state, reducer);
  let notified = 0;
  store.subscribe(() => notified++);
  assert.equal(store.dispatch(action), false, `${action.type} must report no move`);
  assert.equal(notified, 0, `${action.type} must not notify listeners`);
}
