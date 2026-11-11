import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { AppError, IntegrationError } from '@/lib/errors';
import { ARTIFACT_FILE_BETAS } from '../constants';
import { isRangeableMedia, mediaRangeResponse, parseByteRange } from '../lib/byte-range';
import { baseMime } from '../lib/file-types';
import type { OwnedArtifact } from './artifact-access';

// Stream an artifact's bytes from the Anthropic Files API through our origin.
// The browser NEVER talks to Anthropic: this proxy authorizes via the artifact's
// workspace (the route resolves that before calling here) and forwards the body
// with headers safe for <img>/<object>/fetch consumption.
//
// Active content (HTML/SVG/XML) additionally gets `Content-Security-Policy:
// sandbox`: if someone navigates the content URL directly, the document renders
// in an opaque origin with scripts disabled — agent-authored HTML can never run
// on our origin with our cookies. The ArtifactViewer doesn't rely on that
// header; it fetches the text and renders it inside its own sandboxed iframe.
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
]);

export async function openArtifactContent(input: {
  artifact: OwnedArtifact;
  disposition: 'inline' | 'attachment';
  range?: string | null;
}): Promise<Response> {
  const { artifact, disposition } = input;
  const isMedia = isRangeableMedia(artifact.mimeType);
  const requestedRange =
    isMedia && input.range ? parseByteRange(input.range, artifact.sizeBytes) : null;
  if (isMedia && input.range && !requestedRange) {
    return new Response(null, {
      status: 416,
      headers: {
        'content-range': `bytes */${artifact.sizeBytes}`,
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-store',
      },
    });
  }
  const client = requireAnthropicClient();
  if (!artifact.downloadable) {
    // The Files API only serves agent-created files; pre-empt its error with
    // the same 404 the access gate uses so non-downloadable ids leak nothing.
    throw new AppError('ARTIFACT_NOT_FOUND', 'Artifact content is not downloadable', {
      artifactId: artifact.id,
    });
  }

  let upstream: Response;
  try {
    upstream = await client.beta.files.download(
      artifact.anthropicFileId,
      { betas: ARTIFACT_FILE_BETAS },
      requestedRange && input.range ? { headers: { range: input.range } } : undefined,
    );
  } catch (error) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Files API download failed',
      { artifactId: artifact.id },
      { cause: error },
    );
  }

  const headers = new Headers({
    // Trust our mirrored metadata for the type — never upstream sniffing.
    'content-type': artifact.mimeType,
    'x-content-type-options': 'nosniff',
    'content-disposition': contentDisposition(disposition, artifact.filename),
    // Authorized per-request; never cacheable across users or sessions.
    'cache-control': 'private, no-store',
    'cross-origin-resource-policy': 'same-origin',
  });
  if (isMedia) headers.set('accept-ranges', 'bytes');
  // Deliberately NO content-length: the SDK's fetch decompresses the body but
  // keeps the wire (compressed) length header, and forwarding that mismatch
  // makes browsers wait for bytes that never arrive (the HTML preview hung
  // exactly this way live). Chunked transfer is always correct here.
  if (ACTIVE_CONTENT_TYPES.has(baseMime(artifact.mimeType))) {
    headers.set('content-security-policy', 'sandbox');
  }

  if (!requestedRange) return new Response(upstream.body, { status: 200, headers });

  return mediaRangeResponse({
    upstream,
    range: requestedRange,
    size: artifact.sizeBytes,
    headers,
  });
}

// RFC 6266: quoted ASCII fallback + RFC 5987 UTF-8 form for non-ASCII names.
function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
