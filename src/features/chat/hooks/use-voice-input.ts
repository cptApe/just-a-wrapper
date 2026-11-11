'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { reduceVoiceInput, type VoiceState } from '../lib/voice-input-machine';
import { useMachineStore } from './use-machine-store';

export type VoiceInputState = VoiceState['kind'];

/** Rolling-window length — one bar per sample, newest on the right. */
const VOICE_VOLUME_BARS = 48;
const SAMPLE_INTERVAL_MS = 80;

const SILENT_VOLUMES: number[] = Array.from({ length: VOICE_VOLUME_BARS }, () => 0);

function preferredMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Chrome/Firefox record webm; Safari records mp4. Scribe accepts both.
  for (const type of ['audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

const transcriptSchema = z.object({ text: z.string() });

export function useVoiceInput(onTranscript: (text: string) => void) {
  const machine = useMachineStore<VoiceState, Parameters<typeof reduceVoiceInput>[1]>(
    { kind: 'idle' },
    reduceVoiceInput,
  );
  const { dispatch, getSnapshot } = machine;
  const [volumes, setVolumes] = useState<number[]>(SILENT_VOLUMES);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const samplerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep the latest callback without retriggering the recorder wiring.
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  function isCurrent(attempt: symbol) {
    const current = getSnapshot();
    return current.kind !== 'idle' && current.attempt === attempt;
  }

  const stopSampling = useCallback((): void => {
    if (samplerRef.current !== null) {
      clearInterval(samplerRef.current);
      samplerRef.current = null;
    }
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch((error: unknown) => {
        captureException(error, { op: 'voice-audio-context-close' });
      });
    }
  }, []);

  function startSampling(stream: MediaStream): void {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const startedAt = Date.now();

    samplerRef.current = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      // RMS of the time-domain signal (0..1), boosted into a readable bar range —
      // conversational speech sits around 0.05–0.3 raw.
      let sum = 0;
      for (const v of data) {
        const centered = (v - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 3.5);
      setVolumes((prev) => [...prev.slice(1), level]);
      setElapsedMs(Date.now() - startedAt);
    }, SAMPLE_INTERVAL_MS);
  }

  async function transcribe(blob: Blob, attempt: symbol): Promise<void> {
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const form = new FormData();
      form.set('audio', new File([blob], `recording.${extension}`, { type: blob.type }));
      // eslint-disable-next-line no-restricted-syntax -- status branch + FormData: res.status === 503 shows 'voice not configured' and returns; fetchJson would throw past it
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      if (!isCurrent(attempt)) return;
      if (res.status === 503) {
        toast.error(CAPABILITY_OFF_MESSAGES.voice);
        return;
      }
      if (!res.ok)
        throw new AppError('API_REQUEST_FAILED', `transcribe failed: HTTP ${res.status}`, {
          status: res.status,
          url: '/api/transcribe',
        });
      const { text } = transcriptSchema.parse(await res.json());
      if (!isCurrent(attempt)) return;
      if (text) {
        onTranscriptRef.current(text);
      } else {
        toast('Didn’t catch any speech. Try again a little louder.');
      }
    } catch (error) {
      if (!isCurrent(attempt)) return;
      captureException(error, { op: 'voice-transcribe' });
      toast.error('Couldn’t transcribe that recording. Try again.');
    } finally {
      dispatch({ type: 'finish', attempt });
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function start(): Promise<void> {
    const attempt = Symbol('voice');
    if (!dispatch({ type: 'start', attempt })) return;
    setVolumes(SILENT_VOLUMES);
    setElapsedMs(0);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent(attempt)) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        for (const track of recorder.stream.getTracks()) track.stop();
        if (!isCurrent(attempt)) return;
        recorderRef.current = null;
        stopSampling();
        if (getSnapshot().kind === 'recording') dispatch({ type: 'confirm', attempt });
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) {
          dispatch({ type: 'finish', attempt });
          return;
        }
        void transcribe(blob, attempt);
      };
      recorderRef.current = recorder;
      recorder.start();
      startSampling(stream);
      dispatch({ type: 'record', attempt });
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (!isCurrent(attempt)) return;
      dispatch({ type: 'finish', attempt });
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stopSampling();
      captureException(error, { op: 'voice-record-start' });
      toast.error('Microphone unavailable. Check the browser permission.');
    }
  }

  function confirm(): void {
    const current = getSnapshot();
    if (current.kind !== 'recording') return;
    dispatch({ type: 'confirm', attempt: current.attempt });
    recorderRef.current?.stop();
  }

  const cancel = useCallback((): void => {
    dispatch({ type: 'cancel' });
    requestRef.current?.abort();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      if (recorder.state !== 'inactive') recorder.stop();
      for (const track of recorder.stream.getTracks()) track.stop();
    }
    stopSampling();
  }, [dispatch, stopSampling]);

  useEffect(() => cancel, [cancel]);

  return { state: machine.state.kind, volumes, elapsedMs, controls: { start, confirm, cancel } };
}
