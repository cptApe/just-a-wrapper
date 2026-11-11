import { z } from 'zod';
import { AppError, ERROR_CODES, type ErrorCode } from '@/lib/errors';

const errorResponseSchema = z.object({
  error: z
    .object({
      code: z.enum(ERROR_CODES).catch('API_REQUEST_FAILED'),
      message: z.string().optional(),
      expectedState: z.boolean().optional(),
    })
    .optional(),
});

const attachmentSchema = z.object({
  fileId: z.string(),
  anthropicFileId: z.string(),
  name: z.string(),
  durableUrl: z.string(),
  mountedPath: z.string(),
});
const mountedResponseSchema = z.object({ attachment: attachmentSchema });
const fileResponseSchema = z.object({
  file: z.object({
    id: z.string(),
    filename: z.string(),
    url: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
  }),
});

export function readMountedAttachment(
  value: unknown,
  sessionId: string,
  fileName: string,
  source: 'existing' | 'uploaded',
) {
  const parsed = mountedResponseSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'API_REQUEST_FAILED',
      source === 'existing'
        ? 'The existing file was not mounted for the agent.'
        : 'The file was uploaded but was not mounted for the agent.',
      { sessionId, fileName },
      { cause: parsed.error },
    );
  return parsed.data.attachment;
}

export function readSavedLibraryFile(value: unknown, fileName: string) {
  const parsed = fileResponseSchema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'API_REQUEST_FAILED',
      'The file was uploaded but not saved.',
      { fileName },
      { cause: parsed.error },
    );
  const file = parsed.data.file;
  return {
    id: file.id,
    name: file.filename,
    url: file.url,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

// A person reads this in the attach toast; the status stays in the error's context for logs.
const UPLOAD_ERROR_FALLBACK = 'The attachment could not be prepared.';

export async function readUploadError(
  response: Response,
): Promise<{ code: ErrorCode; message: string; expectedState: boolean }> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AppError(
      'API_REQUEST_FAILED',
      UPLOAD_ERROR_FALLBACK,
      { status: response.status },
      { cause },
    );
  }
  const parsed = errorResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new AppError(
      'API_REQUEST_FAILED',
      UPLOAD_ERROR_FALLBACK,
      { status: response.status },
      { cause: parsed.error },
    );
  const error = parsed.data.error;
  return {
    code: error?.code ?? 'API_REQUEST_FAILED',
    message: error?.message ?? UPLOAD_ERROR_FALLBACK,
    expectedState: error?.expectedState === true,
  };
}
