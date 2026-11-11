'use client';
import { useEffect, useReducer } from 'react';
import { initialPace, paceReducer } from '../lib/stream-pace-machine';

export function useSmoothStreamText(target: string): string {
  const [state, dispatch] = useReducer(paceReducer, target, initialPace);
  if (state.target !== target) dispatch({ type: 'target', text: target });
  const smoothing = !(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    if (!smoothing || state.kind === 'caught-up') return;
    let frame: number;
    const tick = (now: number) => {
      dispatch({ type: 'tick', now });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [smoothing, state.kind]);
  return smoothing ? state.shown : target;
}
