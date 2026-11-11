// Verify Composio HMAC over {id}.{timestamp}.{body} with the raw UTF-8 secret.
// The headers resemble Standard Webhooks, but the key is not base64-decoded.
// See docs.composio.dev/docs/webhook-verification.
// Keep this node:crypto-only so signature tests run without app dependencies.

import { createHmac, timingSafeEqual } from 'node:crypto';

export class ComposioWebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposioWebhookVerificationError';
  }
}

// Replay window, mirroring the standardwebhooks default the Anthropic path gets.
const TOLERANCE_SECONDS = 5 * 60;

const HEADER_ID = 'webhook-id';
const HEADER_TIMESTAMP = 'webhook-timestamp';
const HEADER_SIGNATURE = 'webhook-signature';

/**
 * Verify signature + timestamp and return the parsed JSON payload (unknown —
 * the caller validates shape with Zod). Throws ComposioWebhookVerificationError
 * on a missing header, stale/future timestamp, or signature mismatch.
 */
export function verifyComposioWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string,
  nowMs: number = Date.now(),
): { id: string; payload: unknown } {
  const id = headers[HEADER_ID];
  const timestamp = headers[HEADER_TIMESTAMP];
  const signatureHeader = headers[HEADER_SIGNATURE];
  if (!id || !timestamp || !signatureHeader) {
    throw new ComposioWebhookVerificationError('missing webhook signature headers');
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new ComposioWebhookVerificationError('invalid webhook timestamp');
  }
  const skew = Math.abs(nowMs / 1000 - timestampSeconds);
  if (skew > TOLERANCE_SECONDS) {
    throw new ComposioWebhookVerificationError('webhook timestamp outside tolerance');
  }

  const expected = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest();
  // The header may carry several space-separated signatures (vN,<b64> each) —
  // accept if ANY matches, per the Standard Webhooks convention Composio follows.
  const matches = signatureHeader.split(' ').some((candidate) => {
    const b64 = candidate.split(',').at(1) ?? '';
    const received = Buffer.from(b64, 'base64');
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
  if (!matches) {
    throw new ComposioWebhookVerificationError('webhook signature mismatch');
  }

  return { id, payload: JSON.parse(body) };
}

/**
 * Sign a payload the way Composio would — used by unit tests and the synthetic
 * webhook probe to mint valid (and deliberately stale) deliveries.
 */
export function signComposioWebhook(
  id: string,
  body: string,
  secret: string,
  timestamp: Date,
): Record<string, string> {
  const ts = String(Math.floor(timestamp.getTime() / 1000));
  const signature = createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64');
  return {
    [HEADER_ID]: id,
    [HEADER_TIMESTAMP]: ts,
    [HEADER_SIGNATURE]: `v1,${signature}`,
  };
}
