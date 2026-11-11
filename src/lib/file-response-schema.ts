import { z } from 'zod';

const fileEntrySchema = z.object({
  id: z.string(),
  filename: z.string(),
  folderPath: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  url: z.string(),
  source: z.enum(['user_upload', 'agent_generated', 'session_output']),
  createdAt: z.string(),
  deletedAt: z.string().nullable().optional(),
});
const artifactSummarySchema = z.object({
  id: z.string(),
  anthropicFileId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  downloadable: z.boolean(),
  savedDriveFileId: z.string().nullable(),
  createdAt: z.string(),
});
export const libraryFilesSchema = z.object({ files: fileEntrySchema.array() });
export const sessionArtifactsSchema = z.object({ artifacts: artifactSummarySchema.array() });
export const sessionFilesSchema = sessionArtifactsSchema.extend({
  libraryFiles: z.array(
    artifactSummarySchema
      .pick({ id: true, filename: true, mimeType: true, sizeBytes: true, createdAt: true })
      .extend({ url: z.string() }),
  ),
});

export type SessionFilesResponse = z.infer<typeof sessionFilesSchema>;
export const libraryItemsSchema = libraryFilesSchema.extend({
  artifacts: artifactSummarySchema
    .extend({ sessionTitle: z.string().nullable(), sessionRowId: z.string() })
    .array(),
});
