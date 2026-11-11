'use client';
import { type RefObject, useImperativeHandle, useReducer } from 'react';
import { useMediaEnabled } from '@/features/voice/browser';
import { cn } from '@/lib/utils';
import { useComposerCredits } from '../hooks/use-composer-credits';
import { useComposerDraft } from '../hooks/use-composer-draft';
import { useComposerDrop } from '../hooks/use-composer-drop';
import { useComposerInput } from '../hooks/use-composer-input';
import { useComposerSubmit } from '../hooks/use-composer-submit';
import { useComposerUploads } from '../hooks/use-composer-uploads';
import { useCreditsRequiredModal } from '../hooks/use-credits-required-modal';
import { useVoiceInput } from '../hooks/use-voice-input';
import type { AttachContext } from '../lib/attachments';
import { type ComposerCanvasState, reduceComposerCanvas } from '../lib/composer-canvas-machine';
import {
  composerCardClass,
  composerCardInnerClass,
  composerChatColumnClass,
  composerChatWrapClass,
} from '../lib/composer-geometry';
import { composerStatus } from '../lib/composer-status';
import type { ComposerHandle, ComposerSubmission } from '../lib/composer-submission';
import { isCreditsRequired } from '../lib/credits-required-machine';
import { dispatchComposerDraft, readComposerDraft, sessionIdOfDraft } from '../lib/draft-store';
import { LONG_TEXT_ATTACHMENT_CHARS, longTextFile } from '../lib/message-limit';
import type { ComposerCreditsState } from '../types';
import { ComposerAttachCanvas } from './composer-attach-canvas';
import { ComposerCard } from './composer-card';
import { ComposerCreditsNotice } from './composer-credits-notice';
import { ComposerInput } from './composer-input';
import { ComposerToolbar } from './composer-toolbar';
import { CreditsRequiredModal } from './credits-required-modal';

const CLOSED_CANVAS: ComposerCanvasState = { kind: 'closed', mode: 'library', nonce: 0 };

export function Composer({
  onSend,
  streaming = false,
  stopping = false,
  paused = false,
  onStop,
  draftKey,
  attach,
  libraryPicker = false,
  skillPicker = false,
  dragHighlight,
  variant = 'chat',
  placeholder,
  handleRef,
  readOnly = false,
  initialCredits,
}: {
  /** Reject to have the composer restore the draft it cleared. */
  onSend: (submission: ComposerSubmission) => void | Promise<void>;
  /** The agent is mid-turn: send morphs to stop; drafts stay editable. */
  streaming?: boolean;
  /** A stop request is in flight. */
  stopping?: boolean;
  /** A credit pause overrides stale stream and sidebar activity. */
  paused?: boolean;
  onStop?: () => void;
  /** Which draft this composer shows: a session id, or one of Home's keys in `lib/draft-store`. */
  draftKey: string;
  /** Upload wiring; null hides nothing but disables attach affordances. */
  attach?: AttachContext | null;
  /** Offer "Add from library" (opens the Library canvas picker). */
  libraryPicker?: boolean;
  /** Offer "Use skills" (opens the skills canvas picker). */
  skillPicker?: boolean;
  /** The page-level drop zone is active — show the drop highlight. */
  dragHighlight?: boolean;
  variant?: 'chat' | 'home';
  placeholder?: string;
  /** For the surface's page drop zone and New task focus. */
  handleRef?: RefObject<ComposerHandle | null>;
  /** Read-only mode replaces the composer with a disabled view-only bar.
   * It cannot send, attach or create optimistic messages. */
  readOnly?: boolean;
  initialCredits?: Extract<ComposerCreditsState, { kind: 'ready' | 'off' }>;
}) {
  const credits = useComposerCredits(readOnly, paused, initialCredits);
  // Home explains an empty balance with a modal. A task keeps its notice, which says why that
  // task cannot continue.
  const creditsRequired = variant === 'home' && isCreditsRequired(credits.state);
  const creditsModal = useCreditsRequiredModal(creditsRequired);
  const draft = useComposerDraft(draftKey);
  const uploads = useComposerUploads({ draftKey, attachments: draft.attachments, attach });
  const status = composerStatus({
    draft,
    attach,
    credits: credits.state,
    paused,
    streaming,
    stopping,
  });
  const submit = useComposerSubmit({
    draftKey,
    canSubmit: status.canSubmit,
    hasContent: status.hasContent,
    uploadGate: status.uploadGate,
    onSend,
    previewOwner: uploads.previewOwner,
  });
  const sendOpensCreditsModal = creditsRequired && status.hasContent;

  function requestSubmit() {
    if (sendOpensCreditsModal) {
      creditsModal.requestFromSend();
      return;
    }
    const text = readComposerDraft(draftKey).text;
    if (
      !status.canSubmit ||
      !status.attachEnabled ||
      text.trim().length <= LONG_TEXT_ATTACHMENT_CHARS
    ) {
      submit.requestSubmit();
      return;
    }
    // Long text travels as a file; the send waits for its upload.
    uploads.addFiles([longTextFile(text)]);
    input.insertText('');
    submit.requestSubmitAfterUpload();
  }

  const input = useComposerInput({
    draftKey,
    text: draft.text,
    onSubmit: requestSubmit,
    addFiles: uploads.addFiles,
    attachDisabledReason: status.attachDisabledReason,
  });
  const voice = useVoiceInput((transcript) => {
    const current = readComposerDraft(draftKey).text;
    input.insertText(current.trim().length > 0 ? `${current.trimEnd()} ${transcript}` : transcript);
  });
  const voiceActive = voice.state !== 'idle';
  const mediaEnabled = useMediaEnabled();
  const [canvas, dispatchCanvas] = useReducer(reduceComposerCanvas, CLOSED_CANVAS);
  const drop = useComposerDrop(Boolean(attach) && dragHighlight === undefined, uploads.addFiles);
  useImperativeHandle(
    handleRef,
    () => ({ focus: () => input.inputRef.current?.focus(), addFiles: uploads.addFiles }),
    [input.inputRef, uploads.addFiles],
  );

  // Read-only mode keeps the same geometry without input or attachments.
  // Branch after all hooks so writable-state changes preserve hook ordering.
  if (readOnly) {
    const readOnlyCard = (
      <div
        className={cn(composerCardClass, 'cursor-default border-alpha-8')}
        data-testid="composer-readonly"
      >
        <div className={composerCardInnerClass}>
          <div className="flex min-h-9 flex-col justify-center">
            <p className="p-1 text-body-lg leading-6 text-foreground-tertiary">
              Only the task creator can send messages.
            </p>
          </div>
        </div>
      </div>
    );
    if (variant === 'home') return readOnlyCard;
    return (
      <div className={composerChatWrapClass}>
        <div className={composerChatColumnClass}>{readOnlyCard}</div>
      </div>
    );
  }

  const content = (
    <>
      {variant === 'home' ? <CreditsRequiredModal modal={creditsModal} /> : null}
      {!paused && !creditsRequired ? (
        <ComposerCreditsNotice state={credits.state} retry={credits.retry} />
      ) : null}
      {status.messageLimitNotice ? (
        <p role="alert" className="text-meta text-destructive">
          {status.messageLimitNotice}
        </p>
      ) : null}
      <ComposerCard
        draft={draft}
        onUnpick={(kind, key) => dispatchComposerDraft(draftKey, { type: 'unpick', kind, key })}
        onRemoveAttachment={uploads.removeAttachment}
        onRetryAttachment={uploads.retryUpload}
        onSubmit={requestSubmit}
        inputRef={input.inputRef}
        voiceActive={voiceActive}
        dragProps={drop.props}
        showDropOverlay={status.attachEnabled && (drop.active || dragHighlight === true)}
      >
        <ComposerInput
          inputRef={input.inputRef}
          textarea={input.textarea}
          voice={voice}
          voiceActive={voiceActive}
          placeholder={placeholder}
        />
        <ComposerToolbar
          attachDisabledReason={status.attachDisabledReason}
          onAddFiles={uploads.addFiles}
          onOpenLibrary={
            libraryPicker ? () => dispatchCanvas({ type: 'open', mode: 'library' }) : undefined
          }
          onOpenSkills={
            skillPicker ? () => dispatchCanvas({ type: 'open', mode: 'skill' }) : undefined
          }
          voice={voice}
          voiceActive={voiceActive}
          mediaEnabled={mediaEnabled}
          send={{
            mode: status.mode,
            disabled: !status.canSubmit && !submit.sendArmed && !sendOpensCreditsModal,
            onSend: requestSubmit,
            uploading: status.uploadGate === 'uploading',
            sendArmed: submit.sendArmed,
            onStop,
          }}
        />
      </ComposerCard>
      {/* React events bubble through portals, so the canvas stays outside the card's form. */}
      {libraryPicker || skillPicker ? (
        <ComposerAttachCanvas
          mode={canvas.mode}
          open={canvas.kind === 'open'}
          openNonce={canvas.nonce}
          onClose={() => dispatchCanvas({ type: 'close' })}
          onConfirmLibrary={({ files, folders }) =>
            dispatchComposerDraft(draftKey, { type: 'pick', picks: { library: files, folders } })
          }
          onConfirmSkills={(skills) =>
            dispatchComposerDraft(draftKey, { type: 'choose', picks: { skills } })
          }
          skillSelectedIds={draft.skills.map((skill) => skill.id)}
          sessionId={sessionIdOfDraft(draftKey)}
        />
      ) : null}
    </>
  );

  if (variant === 'home') return content;

  return (
    <div className={composerChatWrapClass}>
      <div className={composerChatColumnClass}>{content}</div>
    </div>
  );
}
