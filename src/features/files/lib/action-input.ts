import { z } from 'zod';
import { AppError } from '@/lib/errors';
import type { LibraryFilesQuery } from './library-items';

// Server actions are public POST endpoints, so each one parses its arguments here
// before any query runs. A refusal names what was wrong in the action's own words.

const MAX_BULK_ITEMS = 200;

const id = z.guid();
// Paths and names are checked in full by the path rules; this bounds the shape.
const path = z.string().max(4096);
const name = z.string().max(1024);

export const fileIdsInput = z.array(id).min(1).max(MAX_BULK_ITEMS);
export const fileIdInput = id;
export const folderIdInput = id;
export const shareIdInput = id;
export const folderPathInput = path;
export const nameInput = name;

export const shareTargetInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), folderPath: path }),
  z.object({ kind: z.literal('file'), fileId: id, filename: name }),
]);

export const createShareInput = z.object({
  target: shareTargetInput,
  mode: z.enum(['view', 'edit']),
  expiresInDays: z.number().nullable(),
});

export const libraryFilesQueryInput = z.object({
  path,
  type: z.enum(['images', 'documents', 'spreadsheets', 'presentations', 'pdfs']).nullable(),
  q: z.string().max(1024),
  trash: z.boolean(),
  sort: z.enum(['name', 'kind', 'modified', 'size']),
  dir: z.enum(['asc', 'desc']),
  offset: z.number().int().min(0),
}) satisfies z.ZodType<LibraryFilesQuery>;

/** Parse one action argument, refusing with `message` when it does not fit. */
export function parseActionInput<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('TOOL_INPUT_INVALID', message, {
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
  }
  return parsed.data;
}
