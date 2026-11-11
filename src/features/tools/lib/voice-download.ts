import { MAX_AUDIO_BYTES } from '@/features/voice';
import { IntegrationError, ToolError } from '@/lib/errors';
import { fetchPublicResource } from './fetch-public-resource';
import { assertPublicTarget } from './url-guard';

export type ResolvedUrlAudio = {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
};

async function bytesFromResponse(
  response: Response,
  source: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Could not fetch audio or video bytes', {
      source,
      status: response.status,
    });
  }
  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
    throw new ToolError('TOOL_INPUT_INVALID', 'Audio or video exceeds the 25 MB limit', {
      source,
      sizeBytes: contentLength,
    });
  }
  if (!response.body) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Audio or video response had no body', {
      source,
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new ToolError('TOOL_INPUT_INVALID', 'Audio or video exceeds the 25 MB limit', {
          source,
          sizeBytes: total,
        });
      }
      chunks.push(value);
    }
  } catch (cause) {
    if (cause instanceof ToolError) throw cause;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not read audio or video bytes',
      { source },
      { cause },
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const AUDIO_VIDEO_EXTENSIONS = new Set([
  'aac',
  'flac',
  'm4a',
  'm4v',
  'mkv',
  'mov',
  'mp3',
  'mp4',
  'mpeg',
  'mpga',
  'ogg',
  'opus',
  'wav',
  'webm',
]);

export async function resolveUrlAudio(rawUrl: string): Promise<ResolvedUrlAudio> {
  const { response, url } = await fetchPublicResource(rawUrl, 5, 60_000, fetch, assertPublicTarget);
  let filename: string;
  try {
    filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'recording');
  } catch (cause) {
    throw new ToolError(
      'TOOL_INPUT_INVALID',
      'Audio URL contains an invalid filename',
      { url: url.toString() },
      { cause },
    );
  }
  const mimeType =
    response.headers.get('content-type')?.split(';').at(0)?.trim().toLowerCase() ?? '';
  const extension = filename.split('.').at(-1)?.toLowerCase() ?? '';
  if (
    !mimeType.startsWith('audio/') &&
    !mimeType.startsWith('video/') &&
    !(mimeType === 'application/octet-stream' && AUDIO_VIDEO_EXTENSIONS.has(extension))
  ) {
    throw new ToolError('TOOL_INPUT_INVALID', 'URL did not return audio or video content', {
      url: url.toString(),
      mimeType: mimeType || 'missing',
    });
  }
  return {
    bytes: await bytesFromResponse(response, rawUrl),
    filename,
    mimeType,
  };
}
