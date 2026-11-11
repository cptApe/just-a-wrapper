// Anthropic webhook handler — the relay-independent trigger for headless session
// lifecycle. Verifies (Standard Webhooks HMAC), parses,
// structured-logs, and routes the lifecycle and reliability events we care
// about. Unknown events remain accepted, logged, and ignored.
//
// See docs/spec/04-observability.md §11.2.

import { z } from 'zod';
import { env } from '@/lib/env';
import { WebhookError } from '@/lib/errors';

export { routeAnthropicEvent } from './anthropic-dispatch';

import { verifyAnthropicWebhook, WebhookVerificationError } from './anthropic-verify';

// Loose schemas: we require the envelope + the routing/identity fields, and
// passthrough everything else (session_thread_id, vault_id, trigger_context, …)
// so the shape stays forward-compatible.
const eventDataSchema = z
  .object({
    type: z.string(),
    id: z.string(), // resource id; semantics depend on `type`
    organization_id: z.string(),
    workspace_id: z.string(),
  })
  .loose();

const anthropicWebhookEventSchema = z
  .object({
    id: z.string(), // event id — idempotency key for downstream consumers
    created_at: z.string(),
    type: z.literal('event'),
    data: eventDataSchema,
  })
  .loose();

export type AnthropicWebhookEvent = z.infer<typeof anthropicWebhookEventSchema>;

// The signing secret, or undefined when unset (route returns a typed 503).
export function anthropicWebhookSecret(): string | undefined {
  return env.ANTHROPIC_WEBHOOK_SECRET;
}

// Verify + parse. Throws WebhookVerificationError (bad sig / replay) or ZodError
// (malformed payload); the route maps both to a typed WebhookError.
export function parseAnthropicWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string,
): AnthropicWebhookEvent {
  const verified = verifyAnthropicWebhook(body, headers, secret);
  return anthropicWebhookEventSchema.parse(verified);
}

// Normalize any thrown error into a typed WebhookError with a stable code, so
// the route's status mapping and the captured event are consistent.
export function toWebhookError(err: unknown): WebhookError {
  if (err instanceof WebhookError) return err;
  if (err instanceof WebhookVerificationError) {
    return new WebhookError('WEBHOOK_SIGNATURE_INVALID', err.message, {}, { cause: err });
  }
  if (err instanceof z.ZodError) {
    return new WebhookError(
      'TOOL_INPUT_INVALID',
      'malformed Anthropic webhook payload',
      { issues: err.flatten() },
      { cause: err },
    );
  }
  return new WebhookError(
    'UNEXPECTED',
    err instanceof Error ? err.message : 'unknown webhook error',
    {},
    { cause: err },
  );
}

// HTTP status for a webhook failure. Signature/replay → 401 and malformed
// payload → 400 are PERMANENT (4xx so the sender stops); everything else is
// transient → 500 (the sender retries with backoff).
export function httpStatusForWebhookError(error: WebhookError): number {
  if (error.code === 'WEBHOOK_SIGNATURE_INVALID') return 401;
  if (error.code === 'TOOL_INPUT_INVALID') return 400;
  return 500;
}
