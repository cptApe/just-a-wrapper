'use client';

import { useEffect } from 'react';
import { IconCheck, IconX } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatTimer } from '@/lib/format/format-duration';
import type { VoiceInputState } from '../hooks/use-voice-input';

// The voice takeover, split across the composer's two rows so it occupies the
// same footprint as the resting composer (no layout shift):
//   • ComposerVoiceWave     — replaces ONLY the textarea (row 1): a live waveform
//                             (rolling mic loudness, newest at the right) + timer.
//   • ComposerVoiceControls — sits in the action row (row 2), exactly where the
//                             mic/send buttons live: cancel · confirm/transcribe.
// ESC cancels. Bars animate height only — each is 3px
// wide, height eased 150ms so the meter reads live without flickering.

const WAVE_HEIGHT_PX = 28;
const MIN_BAR_PX = 3;

export function ComposerVoiceWave({
  state,
  volumes,
  elapsedMs,
  onCancel,
}: {
  state: VoiceInputState;
  volumes: number[];
  elapsedMs: number;
  onCancel: () => void;
}) {
  const transcribing = state === 'transcribing';

  // ESC backs out of the takeover without transcribing.
  useEffect(() => {
    if (transcribing) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [transcribing, onCancel]);

  return (
    <div className="flex w-full items-center gap-3" role="status" aria-label="Recording voice">
      <div
        aria-hidden
        className="flex flex-1 items-center justify-between gap-[3px] overflow-hidden"
        style={{ height: WAVE_HEIGHT_PX }}
      >
        {volumes.map((volume, index) => (
          <span
            // The window is a fixed-length rolling buffer — position is identity.
            key={index}
            className="w-[3px] shrink-0 rounded-full bg-foreground transition-[height] duration-150 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none"
            style={{ height: Math.max(MIN_BAR_PX, volume * WAVE_HEIGHT_PX) }}
          />
        ))}
      </div>

      <span className="tabular text-meta font-medium text-muted-foreground">
        {formatTimer(elapsedMs)}
      </span>
    </div>
  );
}

export function ComposerVoiceControls({
  state,
  onCancel,
  onConfirm,
}: {
  state: VoiceInputState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const transcribing = state === 'transcribing';
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Cancel recording"
          >
            <IconX className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Cancel (Esc)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            onClick={onConfirm}
            disabled={state !== 'recording'}
            aria-label={transcribing ? 'Transcribing…' : 'Use this recording'}
            aria-busy={transcribing}
          >
            {transcribing ? <Spinner aria-hidden /> : <IconCheck className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Use this recording</TooltipContent>
      </Tooltip>
    </>
  );
}
