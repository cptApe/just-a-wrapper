// Composio webhook handler — event-triggered task execution. Verifies the Composio HMAC (composio-verify.ts), parses the V3
// trigger payload, and routes to the tasks feature, which starts the run
// session under the trigger's owning task. Mirrors anthropic.ts: this module
// owns verify/parse/route; the route file does nothing.

import { z } from 'zod';
import { handleComposioTrigger } from '@/features/tasks';
import { env } from '@/lib/env';
import { WebhookError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { ComposioWebhookVerificationError, verifyComposioWebhook } from './composio-verify';

// V3 metadata carries routing ids; data contains the provider event.
// Preserve unknown fields because Composio can extend its payload.
const composioMetadataSchema = z
  .object({
    trigger_id: z.string(),
    trigger_slug: z.string().optional(),
    connected_account_id: z.string().optional(),
    user_id: z.string().optional(),
  })
  .loose();

const composioWebhookEventSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    metadata: composioMetadataSchema,
    data: z.unknown().optional(),
    timestamp: z.string().optional(),
  })
  .loose();

export type ComposioWebhookEvent = z.infer<typeof composioWebhookEventSchema> & {
  /** Verified signature header; overrides any body field with the same name. */
  deliveryId: string;
};

// The signing secret, or undefined when unset (route returns a typed 503).
export function composioWebhookSecret(): string | undefined {
  return env.COMPOSIO_WEBHOOK_SECRET;
}

// Verify + parse. Throws ComposioWebhookVerificationError (bad sig / replay) or
// ZodError (malformed payload); the route maps both via toComposioWebhookError.
export function parseComposioWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string,
): ComposioWebhookEvent {
  const verified = verifyComposioWebhook(body, headers, secret);
  return {
    ...composioWebhookEventSchema.parse(verified.payload),
    deliveryId: verified.id,
  };
}

/**
 * Route a verified trigger event to its owning task. Non-trigger event types
 * and unknown trigger instances are logged and ignored (200 — Composio must
 * not retry what we deliberately skip).
 */
export async function routeComposioEvent(event: ComposioWebhookEvent) {
  const outcome = await handleComposioTrigger({
    deliveryId: event.deliveryId,
    triggerId: event.metadata.trigger_id,
    triggerSlug: event.metadata.trigger_slug ?? 'unknown',
    payload: event.data,
  });
  shipLog({
    msg: 'webhook.composio.trigger',
    feature: 'webhooks',
    op: 'composio.trigger',
    event_id: event.id ?? null,
    delivery_id: event.deliveryId,
    trigger_id: event.metadata.trigger_id,
    handled: outcome.handled,
    ...(outcome.handled ? { session_id: outcome.sessionId } : { reason: outcome.reason }),
  });
  return outcome;
}

// Normalize any thrown error into a typed WebhookError (anthropic.ts contract —
// the shared httpStatusForWebhookError maps the codes).
export function toComposioWebhookError(err: unknown): WebhookError {
  if (err instanceof WebhookError) return err;
  if (err instanceof ComposioWebhookVerificationError) {
    return new WebhookError('WEBHOOK_SIGNATURE_INVALID', err.message, {}, { cause: err });
  }
  if (err instanceof z.ZodError) {
    return new WebhookError(
      'TOOL_INPUT_INVALID',
      'malformed Composio webhook payload',
      { issues: err.flatten() },
      { cause: err },
    );
  }
  if (err instanceof SyntaxError) {
    return new WebhookError(
      'TOOL_INPUT_INVALID',
      'non-JSON Composio webhook body',
      {},
      {
        cause: err,
      },
    );
  }
  return new WebhookError(
    'UNEXPECTED',
    err instanceof Error ? err.message : 'unknown webhook error',
    {},
    { cause: err },
  );
}
