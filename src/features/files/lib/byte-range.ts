import { IntegrationError } from '@/lib/errors';

export type ByteRange = { start: number; end: number };

/** Safari refuses audio and video from a source that cannot answer byte ranges. */
export function isRangeableMedia(mimeType: string): boolean {
  return /^(audio|video)\//i.test(mimeType.trim());
}

export function parseByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(end, size - 1) };
}

export async function mediaRangeResponse(input: {
  upstream: Response;
  range: ByteRange;
  size: number;
  headers: Headers;
}): Promise<Response> {
  const { upstream, range, size, headers } = input;
  const length = range.end - range.start + 1;
  headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`);
  headers.set('content-length', String(length));
  if (upstream.status !== 206) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Files API did not honor the audio range request',
      { status: upstream.status },
    );
  }
  return new Response(upstream.body, { status: 206, headers });
}
