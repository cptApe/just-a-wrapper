// Pure HMAC verification for Anthropic webhooks. Anthropic implements the
// Standard Webhooks spec (the same scheme OpenAI / Stripe-via-svix use) — the
// `@anthropic-ai/sdk` itself verifies via the `standardwebhooks` package, so we
// use it directly here rather than reimplementing the HMAC.
//
// Scheme: headers `webhook-id`, `webhook-timestamp`, `webhook-signature`;
// signature is `v1,<base64(HMAC-SHA256(key, "{id}.{timestamp}.{body}"))>`; the
// signing key is the `whsec_`-prefixed base64 secret from the Anthropic Console.
// verify() also enforces a ±5-minute timestamp window — replay protection.
//
// Dependency-light on purpose (only `standardwebhooks`, no errors.ts / env): it
// loads under strip-only `node --test` so the HMAC contract is unit-tested in
// isolation. The route maps the thrown WebhookVerificationError to a typed
// WebhookError. See docs/spec/04-observability.md §11.2.

import { Webhook, WebhookVerificationError } from 'standardwebhooks';

export { WebhookVerificationError };

// Verify the signature + timestamp and return the parsed JSON payload (unknown —
// the caller validates shape with Zod). Throws WebhookVerificationError on a bad
// signature, a missing header, or a stale/future timestamp (replay).
export function verifyAnthropicWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string,
): unknown {
  const wh = new Webhook(secret);
  return wh.verify(body, headers);
}

// Sign a payload the way Anthropic would — used by the unit test to mint valid
// and replayed signatures. `timestamp` defaults to now; pass an old Date to
// exercise replay rejection.
export function signAnthropicWebhook(
  id: string,
  body: string,
  secret: string,
  timestamp: Date,
): Record<string, string> {
  const wh = new Webhook(secret);
  return {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
    'webhook-signature': wh.sign(id, timestamp, body),
  };
}
