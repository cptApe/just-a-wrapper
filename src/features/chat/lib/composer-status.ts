import type { ComposerCreditsState } from '../types';
import { attachmentSendGate } from './attachment-validation';
import type { AttachContext } from './attachments';
import { composerSendMode } from './chat-working';
import { type ComposerDraft, draftHasContent } from './composer-draft';
import { INLINE_LIMIT_NOTICE, MAX_INLINE_TEXT_CHARS } from './message-limit';

const UPLOADS_UNAVAILABLE = 'File uploads aren’t available right now.';

/** What the composer may do with this draft right now. Derived on every render, never stored. */
export function composerStatus({
  draft,
  attach,
  credits,
  paused,
  streaming,
  stopping,
}: {
  draft: ComposerDraft;
  attach: AttachContext | null | undefined;
  credits: ComposerCreditsState;
  paused: boolean;
  streaming: boolean;
  stopping: boolean;
}) {
  const attachEnabled = attach?.uploadConfig.enabled === true;
  const attachDisabledReason = !attach
    ? UPLOADS_UNAVAILABLE
    : attach.uploadConfig.enabled
      ? null
      : attach.uploadConfig.reason;
  const hasContent = draftHasContent(draft);
  const creditsAvailable =
    credits.kind === 'off' || (credits.kind === 'ready' && credits.creditBalance > 0);
  const messageLimitNotice =
    !attachEnabled && draft.text.length > MAX_INLINE_TEXT_CHARS ? INLINE_LIMIT_NOTICE : null;
  return {
    attachEnabled,
    attachDisabledReason,
    hasContent,
    messageLimitNotice,
    uploadGate: attachmentSendGate(draft.attachments),
    canSubmit:
      hasContent && !stopping && !paused && creditsAvailable && messageLimitNotice === null,
    mode: composerSendMode({ paused, running: streaming && !hasContent, stopping }),
  };
}
