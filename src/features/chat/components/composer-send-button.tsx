'use client';

import { IconArrowUp, IconSquare } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// The composer's primary button: a theme-flip pill that is "send" at rest and
// morphs to "stop" while the agent streams. The morph is a crossfade+scale
// between the two stacked icons, transform/opacity only.

type SendButtonMode = 'send' | 'stop' | 'stopping';

export function ComposerSendButton({
  mode,
  disabled,
  uploading = false,
  sendArmed = false,
  onSend,
  onStop,
}: {
  mode: SendButtonMode;
  /** Disables SEND only. Stop's availability comes from `onStop`. */
  disabled?: boolean;
  uploading?: boolean;
  sendArmed?: boolean;
  onSend: () => void;
  /** Absent while the task is still being created and nothing can be stopped yet. */
  onStop: (() => void) | undefined;
}) {
  const stopping = !sendArmed && mode === 'stopping';
  const stopUnavailable = onStop === undefined;
  const showStop = !sendArmed && mode !== 'send';
  // Only a send pressed while files are still uploading spins the button; an
  // upload on its own keeps the arrow (the chip carries that spinner).
  const waiting = !showStop && sendArmed;

  const button = (
    <Button
      type="button"
      size="icon-sm"
      onClick={showStop ? onStop : onSend}
      disabled={showStop ? stopping || stopUnavailable : disabled}
      aria-label={
        showStop
          ? stopping
            ? 'Stopping…'
            : 'Stop the agent'
          : sendArmed
            ? 'Cancel waiting send'
            : uploading
              ? 'Send when files finish uploading'
              : 'Send message'
      }
      aria-busy={stopping || waiting}
      aria-pressed={showStop ? undefined : sendArmed}
      className="relative shrink-0 max-md:size-11"
      data-testid="composer-send"
      data-mode={mode}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none',
          showStop ? 'scale-50 opacity-0' : 'scale-100 opacity-100',
        )}
      >
        {waiting ? <Spinner aria-hidden /> : <IconArrowUp className="size-4" />}
      </span>
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 grid place-items-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(0,0,0.2,1)] motion-reduce:transition-none',
          showStop ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      >
        {stopping ? <Spinner aria-hidden /> : <IconSquare className="size-3.5 fill-current" />}
      </span>
    </Button>
  );

  if (!showStop && !waiting) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top">
        {waiting
          ? 'Waiting for files to upload'
          : stopping
            ? 'Stopping…'
            : stopUnavailable
              ? 'This task is still starting'
              : 'Stop the agent'}
      </TooltipContent>
    </Tooltip>
  );
}
