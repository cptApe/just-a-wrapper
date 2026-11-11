import { buildComposerMessage } from '@/features/sessions/lib/build-composer-message';
import type {
  ComposerLibraryFile,
  ComposerLibraryFolder,
  ComposerSkill,
} from '@/features/sessions/types';
import { AppError } from '@/lib/errors';
import {
  type AttachContext,
  type AttachOutcome,
  type PendingAttachment,
  uploadAndAttach,
} from './attachments';

type SendWithAttachmentsInput = {
  text: string;
  attachments: PendingAttachment[];
  library: ComposerLibraryFile[];
  libraryFolders: ComposerLibraryFolder[];
  skills: ComposerSkill[];
  attachContext: AttachContext | null;
  sessionId: string;
  send: (text: string) => Promise<void>;
  onPrepared?: (text: string) => void | Promise<void>;
};

function attachmentBatchError(outcome: AttachOutcome): AppError {
  const first = outcome.failed.at(0);
  if (!first) throw new AppError('UNEXPECTED', 'Attachment batch has no failed file');
  const names = outcome.failed.map((failure) => failure.name);
  const prefix =
    names.length === 1 ? `Couldn’t attach ${names[0]}.` : `Couldn’t attach ${names.length} files.`;
  return new AppError(first.code, `${prefix} ${first.message}`, {
    failed: outcome.failed,
    expectedState: true,
  });
}

/** Prepare every local file, then emit exactly one user message. */
export async function sendWithAttachments(
  input: SendWithAttachmentsInput,
): Promise<{ text: string; outcome: AttachOutcome }> {
  const outcome = await uploadAndAttach(
    input.attachments,
    input.attachContext,
    input.sessionId,
    undefined,
  );
  if (outcome.failed.length > 0) throw attachmentBatchError(outcome);

  const text = buildComposerMessage(
    input.text,
    input.library,
    input.libraryFolders,
    input.skills,
    outcome.attached,
  );
  await input.onPrepared?.(text);
  await input.send(text);
  return { text, outcome };
}
