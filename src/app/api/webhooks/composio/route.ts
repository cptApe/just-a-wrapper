// Composio webhook — event-triggered task execution.
// The route does nothing: open request context, verify+parse+route via the
// webhooks feature, map failures to HTTP status. All logic lives in
// features/webhooks + features/tasks. Mirrors webhooks/anthropic/route.ts.

import {
  composioWebhookSecret,
  httpStatusForWebhookError,
  parseComposioWebhook,
  routeComposioEvent,
  toComposioWebhookError,
} from '@/features/webhooks';
import { shipLog } from '@/lib/logger';
import { extend } from '@/lib/request-context';
import { ROUTE_ERROR_MESSAGES } from '@/lib/route-error-messages';
import { withApiRoute } from '@/lib/route-kit';

// Node.js runtime: HMAC verify + posthog-node + OTLP exporter are node modules.
export const runtime = 'nodejs';
// Trigger handling creates an Anthropic session — same budget as /api/sessions.
export const maxDuration = 120;

export const POST = withApiRoute(
  {
    route: 'webhooks.composio',
    feature: 'webhooks',
    errorResponse(error) {
      const webhookError = toComposioWebhookError(error);
      return Response.json(
        { error: { code: webhookError.code, message: ROUTE_ERROR_MESSAGES[webhookError.code] } },
        { status: httpStatusForWebhookError(webhookError) },
      );
    },
  },
  async (request) => {
    // The secret is optional so builds can run without webhook configuration.
    const secret = composioWebhookSecret();
    extend({
      webhookSource: 'composio',
      hasSecret: Boolean(secret),
      hasHeader: request.headers.has('webhook-signature'),
    });
    if (!secret)
      return Response.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Webhook secret is not configured' } },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );

    // Raw body — the HMAC is computed over the exact bytes, so never re-stringify.
    const body = await request.text();
    const headers = Object.fromEntries(request.headers);
    const event = parseComposioWebhook(body, headers, secret);
    const outcome = await routeComposioEvent(event);
    shipLog({
      msg: 'webhook.handled',
      feature: 'webhooks',
      op: 'composio',
      event_id: event.id ?? null,
      delivery_id: event.deliveryId,
    });

    return Response.json({ ok: true, ...outcome });
  },
);
