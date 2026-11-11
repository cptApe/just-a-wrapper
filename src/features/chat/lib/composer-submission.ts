import type { OptimisticComposerAttachment } from '@/features/sessions/lib/build-composer-message';
import type { ComposerDraft } from './composer-draft';

// Attachment-only sends use this prompt.
export const ATTACHMENTS_ONLY_MESSAGE = 'Take a look at the attached files.';

/** One send: the draft as it was when the person pressed send, and the text it sends. */
export type ComposerSubmission = {
  draft: ComposerDraft;
  /** The draft's text, or the attachments-only prompt when there is none. */
  text: string;
  optimisticAttachments: OptimisticComposerAttachment[];
  /** The surface now shows these previews, so the composer must not revoke them. */
  claimAttachmentPreviews: () => void;
};

/** What a surface may do to its composer from outside: the page drop zone and New task. */
export type ComposerHandle = {
  focus: () => void;
  addFiles: (files: Iterable<File>) => void;
};
