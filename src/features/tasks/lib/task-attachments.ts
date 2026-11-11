import { z } from 'zod';
import { buildComposerMessage } from '@/features/sessions/lib/build-composer-message';
import { FILE_CONTENT_PATH } from '@/lib/file-content-url';

// Persist schedule attachment references and render them in every kickoff
// using the same file-URL and folder-path syntax as the chat composer.

export const TaskAttachmentsSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(300),
        url: z.string().regex(FILE_CONTENT_PATH),
        mimeType: z.string().max(200),
        sizeBytes: z.number().int().nonnegative().default(0),
      }),
    )
    .max(20),
  folders: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        name: z.string().min(1).max(300),
        itemCount: z.number().int().nonnegative(),
      }),
    )
    .max(10),
});
export type TaskAttachments = z.infer<typeof TaskAttachmentsSchema>;

function hasAttachments(value: TaskAttachments | null | undefined): boolean {
  return Boolean(value && (value.files.length > 0 || value.folders.length > 0));
}

/** The kickoff text: the instructions plus the <attached_files> block chat uses. */
export function withAttachedFiles(
  description: string,
  attachments: TaskAttachments | null | undefined,
): string {
  if (!hasAttachments(attachments) || !attachments) return description;
  return buildComposerMessage(description, attachments.files, attachments.folders, []);
}
