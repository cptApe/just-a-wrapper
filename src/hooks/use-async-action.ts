'use client';
import { useCallback, useReducer } from 'react';
import { useAttemptToken } from '@/hooks/use-attempt-token';
import { asyncActionReducer } from '@/lib/async-action-machine';

/** One request at a time: `begin`/`finish` for hand-held flows, `run` for a single awaited call. */
export function useAsyncAction() {
  const [state, dispatch] = useReducer(asyncActionReducer, { kind: 'idle' });
  const { begin: beginAttempt, finish: finishAttempt, isCurrent } = useAttemptToken();
  const begin = useCallback(() => {
    const token = beginAttempt();
    if (token !== null) dispatch({ type: 'start', attempt: token });
    return token;
  }, [beginAttempt]);
  const finish = useCallback(
    (token: symbol) => {
      if (finishAttempt(token)) dispatch({ type: 'finish', attempt: token });
    },
    [finishAttempt],
  );
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      const token = begin();
      if (token === null) return;
      try {
        await operation();
      } finally {
        finish(token);
      }
    },
    [begin, finish],
  );
  return { pending: state.kind === 'pending', begin, finish, isCurrent, run };
}
