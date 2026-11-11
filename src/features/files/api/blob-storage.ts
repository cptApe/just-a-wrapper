import 'server-only';
import { del, get, head, issueSignedToken, list, presignUrl, put } from '@vercel/blob';
import { AppError, IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities, storageCapability } from '@/lib/runtime-capabilities';

// Storage off surfaces as the capability sentence; every wrapper rethrows AppErrors,
// so only real provider failures become EXTERNAL_API_FAILED.
export function blobToken(): string {
  return storageCapability().token;
}

export function storageEnabled(): boolean {
  return capabilities.storage.kind !== 'off';
}

export async function readBlobBytes(
  pathname: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const response = await get(pathname, {
      access: 'private',
      token: blobToken(),
      abortSignal: AbortSignal.timeout(60_000),
    });
    if (!response || response.statusCode !== 200) {
      throw new AppError('ARTIFACT_NOT_FOUND', 'Stored file not found.', { pathname });
    }
    const reader = response.stream.getReader();
    // Stop retaining bytes at the caller's cap, even if the provider omits or misreports size.
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new AppError('VALIDATION_FAILED', 'File exceeds the read limit.', {
            pathname,
            maxBytes,
          });
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not read private file.',
      { pathname },
      { cause },
    );
  }
}

export async function writeBlob(
  pathname: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
) {
  try {
    return await put(pathname, Buffer.from(bytes), {
      access: 'private',
      token: blobToken(),
      contentType,
      addRandomSuffix: false,
    });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not store private file.',
      { pathname },
      { cause },
    );
  }
}

export async function inspectBlob(pathname: string) {
  try {
    return await head(pathname, { token: blobToken() });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not inspect uploaded file.',
      { pathname },
      { cause },
    );
  }
}

let delegation: { expiresAt: number; token: ReturnType<typeof issueSignedToken> } | null = null;

export async function signedBlobUrl(pathname: string): Promise<string> {
  try {
    if (!delegation || delegation.expiresAt < Date.now() + 360_000) {
      const expiresAt = Date.now() + 3_600_000;
      delegation = {
        expiresAt,
        token: issueSignedToken({ token: blobToken(), operations: ['get'], validUntil: expiresAt }),
      };
    }
    const signed = await delegation.token;
    const url = await presignUrl(signed, {
      operation: 'get',
      pathname,
      access: 'private',
      validUntil: Date.now() + 300_000,
    });
    return url.presignedUrl;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    delegation = null;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not sign private file URL.',
      { pathname },
      { cause },
    );
  }
}

export async function deleteBlob(pathname: string | string[]): Promise<void> {
  try {
    await del(pathname, { token: blobToken(), abortSignal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not remove uploaded bytes.',
      { pathname },
      { cause },
    );
  }
}

// Failed recovery must not replace the original operation's result; the orphan sweep retries.
export async function cleanupBlob(pathname: string): Promise<void> {
  try {
    await deleteBlob(pathname);
  } catch (cause) {
    captureException(cause, { operation: 'blob-cleanup', pathname });
  }
}

export async function downloadBlob(pathname: string, filename: string): Promise<Response> {
  try {
    const stored = await get(pathname, {
      access: 'private',
      token: blobToken(),
      abortSignal: AbortSignal.timeout(60_000),
    });
    if (!stored || stored.statusCode !== 200)
      throw new AppError('ARTIFACT_NOT_FOUND', 'Stored file not found.', { pathname });
    return new Response(stored.stream, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not read private file.',
      { pathname },
      { cause },
    );
  }
}

export const THUMBNAIL_SOURCE_MAX_BYTES = 50 * 1024 * 1024;

export const THUMBNAIL_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
];

export async function createThumbnail(input: {
  workspaceId: string;
  fileId: string;
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
}): Promise<string | null> {
  if (
    !THUMBNAIL_TYPES.includes(input.mimeType) ||
    input.bytes.byteLength > THUMBNAIL_SOURCE_MAX_BYTES
  )
    return null;
  try {
    // One size serves every density: a 512px-wide tile stays sharp on a 2x screen.
    const { default: sharp } = await import('sharp');
    const image = await sharp(input.bytes)
      .resize({ width: 1024, withoutEnlargement: true })
      .webp()
      .toBuffer();
    const pathname = `ws/${input.workspaceId}/.thumbs/${input.fileId}.webp`;
    await writeBlob(pathname, new Uint8Array(image), 'image/webp');
    return pathname;
  } catch (cause) {
    // A file is never lost because its preview could not be made.
    captureException(cause, { fileId: input.fileId, operation: 'thumbnail' });
    return null;
  }
}

export async function listStoredBlobs(prefix: string, cursor: string | undefined) {
  try {
    return await list({
      prefix,
      cursor,
      limit: 1000,
      token: blobToken(),
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not list stored files.',
      { prefix },
      { cause },
    );
  }
}
