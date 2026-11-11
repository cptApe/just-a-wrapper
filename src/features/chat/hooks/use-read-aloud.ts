'use client';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { type ReadAloudState, readAloudReducer } from '../lib/read-aloud-machine';
import { useMachineStore } from './use-machine-store';

export function useReadAloud(sessionId: string, text: string) {
  const { state, dispatch } = useMachineStore<
    ReadAloudState,
    Parameters<typeof readAloudReducer>[1]
  >({ kind: 'idle' }, readAloudReducer);
  const controller = useRef<AbortController | null>(null);
  const playback = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  function stop() {
    controller.current?.abort();
    controller.current = null;
    if (playback.current) {
      playback.current.audio.pause();
      playback.current.audio.onended = null;
      URL.revokeObjectURL(playback.current.url);
      playback.current = null;
    }
    dispatch({ type: 'stop' });
  }
  useEffect(() => () => {
    controller.current?.abort();
    if (playback.current) {
      playback.current.audio.pause();
      URL.revokeObjectURL(playback.current.url);
    }
  });
  async function start() {
    const attempt = Symbol();
    if (!dispatch({ type: 'start', attempt })) return;
    const request = new AbortController();
    controller.current = request;
    try {
      // eslint-disable-next-line no-restricted-syntax -- speech endpoint returns an audio blob
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
        signal: request.signal,
      });
      if (!response.ok)
        throw new AppError('API_REQUEST_FAILED', `Speech request failed: HTTP ${response.status}`, {
          sessionId,
        });
      const blob = await response.blob();
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playback.current = { audio, url };
      audio.onended = stop;
      await audio.play();
      request.signal.throwIfAborted();
      dispatch({ type: 'playing', attempt });
    } catch (error) {
      if (request.signal.aborted) return;
      captureException(error, { op: 'chat.read-aloud', sessionId });
      toast.error('Couldn’t read this aloud right now.');
      stop();
    }
  }
  return { state: state.kind, start, stop };
}
