'use client';
import { useRef } from 'react';
import { toast } from 'sonner';
import { IconMicrophone01 } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { cn } from '@/lib/utils';
import type { useVoiceInput } from '../hooks/use-voice-input';
import { ComposerAttachMenu } from './composer-attach-menu';
import { ComposerSendButton } from './composer-send-button';
import { ComposerVoiceControls } from './composer-voice';

export function ComposerToolbar({
  attachDisabledReason,
  onAddFiles,
  onOpenLibrary,
  onOpenSkills,
  voice,
  voiceActive,
  mediaEnabled,
  send,
}: {
  /** Null when files can be attached. */
  attachDisabledReason: string | null;
  onAddFiles: (files: Iterable<File>) => void;
  onOpenLibrary: (() => void) | undefined;
  onOpenSkills: (() => void) | undefined;
  voice: ReturnType<typeof useVoiceInput>;
  voiceActive: boolean;
  mediaEnabled: boolean;
  send: React.ComponentProps<typeof ComposerSendButton>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex w-full items-center justify-between gap-2">
      {/* Left: attachment controls. Hidden during recording but keeps its space. */}
      <div className={cn('flex items-center gap-1', voiceActive && 'invisible')}>
        <ComposerAttachMenu
          disabled={attachDisabledReason !== null}
          disabledReason={attachDisabledReason}
          onPickFromComputer={() => fileInputRef.current?.click()}
          onOpenLibrary={onOpenLibrary}
          onOpenSkills={onOpenSkills}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onAddFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Right: during dictation the wave's cancel/transcribe controls sit
              here, exactly where mic/send live — so only the textarea area above
              swaps to the wave, not this row. */}
      <div className="flex items-center gap-2">
        {voiceActive ? (
          <ComposerVoiceControls
            state={voice.state}
            onCancel={voice.controls.cancel}
            onConfirm={voice.controls.confirm}
          />
        ) : (
          <>
            {/* A native disabled button would swallow the hover and tap that explain why. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    if (mediaEnabled) void voice.controls.start();
                    else toast.error(CAPABILITY_OFF_MESSAGES.voice);
                  }}
                  aria-label="Dictate your message"
                  aria-disabled={!mediaEnabled}
                  className={cn('max-md:size-11', !mediaEnabled && 'opacity-50')}
                  data-testid="composer-mic"
                >
                  <IconMicrophone01 className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {mediaEnabled ? 'Dictate' : CAPABILITY_OFF_MESSAGES.voice}
              </TooltipContent>
            </Tooltip>

            <ComposerSendButton {...send} />
          </>
        )}
      </div>
    </div>
  );
}
