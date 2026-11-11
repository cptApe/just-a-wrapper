import type { RelayFrame } from '@/features/sessions';
import { captureException } from '@/lib/observability-client';
import { describeRelayFrameShape, safeParseRelayFrame } from './relay-frame-schema';

// The wire boundary: decode one SSE `data:` payload to a typed frame. Both
// failure modes — undecodable JSON and a frame that violates the contract — are
// captured and collapsed to `null` so a single bad payload is reported but never
// crashes the stream (the listeners skip `null`).
export function decodeFrame(raw: string): RelayFrame | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    captureException(cause, { op: 'chat.sse.decode-json' });
    return null;
  }
  const result = safeParseRelayFrame(json);
  if (!result.ok) {
    // EventSource applies an SSE `id:` on receipt, before this application-level
    // validation can reject the payload. A later cursorless remint/full replay is
    // therefore the recovery backstop for a malformed event that advanced it.
    // The frame's discriminators + key names ride along (never field values):
    // a rejected frame must say WHICH kind drifted, not just that one did.
    captureException(new Error(result.failure.message), {
      op: 'chat.sse.decode-frame',
      issues: result.failure.issues,
      frame: describeRelayFrameShape(json),
    });
    return null;
  }
  return result.frame;
}
