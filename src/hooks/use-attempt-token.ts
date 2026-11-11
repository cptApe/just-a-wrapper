'use client';
import { useCallback, useEffect, useRef } from 'react';

// The token serializes rapid events before React renders and invalidates late completions.
export function useAttemptToken() {
  const attempt = useRef<symbol | null>(null);
  useEffect(
    () => () => {
      attempt.current = null;
    },
    [],
  );
  const begin = useCallback(() => {
    if (attempt.current !== null) return null;
    const token = Symbol();
    attempt.current = token;
    return token;
  }, []);
  const finish = useCallback((token: symbol) => {
    if (attempt.current !== token) return false;
    attempt.current = null;
    return true;
  }, []);
  const isCurrent = useCallback((token: symbol) => attempt.current === token, []);
  return { begin, finish, isCurrent };
}
