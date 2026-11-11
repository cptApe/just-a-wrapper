import { toFile } from '@anthropic-ai/sdk';
import { IntegrationError } from '@/lib/errors';
import { MAX_SESSION_MOUNT_BYTES } from './limits';

// Intentionally no `server-only` import: this byte-boundary module follows the
// repository's test-injection pattern and runs directly under node --test.

const FILE_BETAS: Array<'files-api-2025-04-14' | 'managed-agents-2026-04-01'> = [
  'files-api-2025-04-14',
  'managed-agents-2026-04-01',
];

type FilesClient = {
  beta: {
    files: {
      upload(input: {
        file: File;
        betas: typeof FILE_BETAS;
      }): Promise<{ id: string; size_bytes: number }>;
    };
  };
};

type UploadInput = {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  sourceSizeBytes: number;
};

/** Move one durable upload into Anthropic without ever accepting missing bytes. */
export async function uploadFileToAnthropic(
  client: FilesClient,
  input: UploadInput,
): Promise<{ fileId: string; sizeBytes: number }> {
  if (!Number.isSafeInteger(input.sourceSizeBytes) || input.sourceSizeBytes <= 0) {
    throw new IntegrationError('VALIDATION_FAILED', 'The attached file is empty.', {
      filename: input.filename,
      sourceSizeBytes: input.sourceSizeBytes,
      expectedState: true,
    });
  }
  if (input.sourceSizeBytes > MAX_SESSION_MOUNT_BYTES) {
    throw new IntegrationError('VALIDATION_FAILED', 'The attached file exceeds the 25 MB limit.', {
      filename: input.filename,
      sourceSizeBytes: input.sourceSizeBytes,
      maxSizeBytes: MAX_SESSION_MOUNT_BYTES,
      expectedState: true,
    });
  }

  const bytes = input.bytes;
  if (bytes.byteLength !== input.sourceSizeBytes) {
    throw new IntegrationError(
      'VALIDATION_FAILED',
      bytes.byteLength === 0
        ? 'The attached file was stored without any content.'
        : 'The attached file size changed during upload.',
      {
        filename: input.filename,
        expectedSizeBytes: input.sourceSizeBytes,
        receivedSizeBytes: bytes.byteLength,
        expectedState: true,
      },
    );
  }

  let uploaded: { id: string; size_bytes: number };
  try {
    uploaded = await client.beta.files.upload({
      file: await toFile(bytes, input.filename, { type: input.mimeType }),
      betas: FILE_BETAS,
    });
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Failed to upload the attached file to the agent.',
      { filename: input.filename, sizeBytes: bytes.byteLength },
      { cause },
    );
  }
  if (uploaded.size_bytes !== bytes.byteLength) {
    throw new IntegrationError(
      'VALIDATION_FAILED',
      'The attached file reached Anthropic incomplete.',
      {
        filename: input.filename,
        expectedSizeBytes: bytes.byteLength,
        receivedSizeBytes: uploaded.size_bytes,
        anthropicFileId: uploaded.id,
        expectedState: true,
      },
    );
  }

  return { fileId: uploaded.id, sizeBytes: uploaded.size_bytes };
}
