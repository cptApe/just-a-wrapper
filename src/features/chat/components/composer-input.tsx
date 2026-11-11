'use client';
import type { useComposerInput } from '../hooks/use-composer-input';
import type { useVoiceInput } from '../hooks/use-voice-input';
import { ComposerVoiceWave } from './composer-voice';

export function ComposerInput({
  inputRef,
  textarea,
  voice,
  voiceActive,
  placeholder,
}: {
  inputRef: ReturnType<typeof useComposerInput>['inputRef'];
  textarea: ReturnType<typeof useComposerInput>['textarea'];
  voice: ReturnType<typeof useVoiceInput>;
  voiceActive: boolean;
  placeholder: string | undefined;
}) {
  return (
    <div className="flex min-h-9 flex-col justify-center">
      {voiceActive ? (
        <ComposerVoiceWave
          state={voice.state}
          volumes={voice.volumes}
          elapsedMs={voice.elapsedMs}
          onCancel={voice.controls.cancel}
        />
      ) : (
        <textarea
          ref={inputRef}
          value={textarea.value}
          rows={1}
          onChange={textarea.onChange}
          onSelect={textarea.onSelect}
          onKeyDown={textarea.onKeyDown}
          onPaste={textarea.onPaste}
          placeholder={placeholder ?? 'Assign a task or ask anything'}
          aria-label="Message"
          // Touch keyboards get a newline-returning Enter (see handleKeyDown);
          // tell the on-screen keyboard so its return key reads "enter", not
          // "send". Desktop keeps the platform default (no explicit hint).
          enterKeyHint={textarea.enterKeyHint}
          // A bare textarea on purpose: the card is the only focus affordance
          // (its :focus-within border). The shared ui/Textarea's own ring +
          // ring-offset + box-shadow transition would paint a second frame
          // that flickers on focus in/out (text inputs get :focus-visible even
          // on click). So: no ring, no shadow, no native outline, no transition.
          className="min-h-0 max-md:max-h-[30dvh] w-full resize-none bg-transparent p-1 text-body-lg leading-6 text-foreground outline-none placeholder:text-foreground-tertiary"
        />
      )}
    </div>
  );
}
