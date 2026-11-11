import 'server-only';
import { readBlobBytes } from '@/features/files/api/blob-storage';
import { IntegrationError, ToolError } from '@/lib/errors';
import { fetchPublicResource } from '../lib/fetch-public-resource';
import type { ResolvedToolFile } from '../lib/registered-tool-files';
import { assertPublicTarget } from '../lib/url-guard';
export async function readToolFileBytes(
  resolved: ResolvedToolFile,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }> {
  if (resolved.source.kind === 'blob')
    return {
      bytes: await readBlobBytes(resolved.source.storagePath, maxBytes),
      mimeType: resolved.mimeType,
    };
  if (resolved.source.kind === 'bytes') {
    if (resolved.source.bytes.byteLength > maxBytes) {
      throw new ToolError('TOOL_INPUT_INVALID', 'The file exceeds the read limit.', {
        filename: resolved.filename,
        sizeBytes: resolved.source.bytes.byteLength,
        maxBytes,
      });
    }
    return { bytes: resolved.source.bytes, mimeType: resolved.mimeType };
  }

  const { response, url } = await fetchPublicResource(
    resolved.source.url,
    5,
    60_000,
    fetch,
    assertPublicTarget,
  );
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Could not fetch file bytes.', {
      url: url.toString(),
      status: response.status,
    });
  }
  const contentLength = response.headers.get('content-length');
  const declaredSize = contentLength === null ? null : Number(contentLength);
  if (declaredSize !== null && Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new ToolError('TOOL_INPUT_INVALID', 'The file exceeds the read limit.', {
      filename: resolved.filename,
      sizeBytes: declaredSize,
      maxBytes,
    });
  }
  const bytes = await readResponseBytes(response, resolved.filename, maxBytes);
  return {
    bytes,
    mimeType:
      resolved.mimeType ||
      response.headers.get('content-type')?.split(';').at(0)?.trim().toLowerCase() ||
      'application/octet-stream',
  };
}

export async function readResponseBytes(
  response: Response,
  filename: string,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        await reader.cancel();
        throw new ToolError('TOOL_INPUT_INVALID', 'The file exceeds the read limit.', {
          filename,
          sizeBytes,
          maxBytes,
        });
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof ToolError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not read file bytes.',
      { filename },
      { cause },
    );
  }
  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
