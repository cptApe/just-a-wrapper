// Anthropic webhook — headless session-lifecycle trigger.
// The route does nothing: open request context, verify+parse+route via the
// webhooks feature, map failures to HTTP status. All logic lives in
// features/webhooks. See docs/spec/04-observability.md §11.2.

import {
  anthropicWebhookSecret,
  httpStatusForWebhookError,
  parseAnthropicWebhook,
  routeAnthropicEvent,
  toWebhookError,
} from '@/features/webhooks';
import { shipLog } from '@/lib/logger';
import { extend, requireCtx } from '@/lib/request-context';
import { ROUTE_ERROR_MESSAGES } from '@/lib/route-error-messages';
import { withApiRoute } from '@/lib/route-kit';
import { parseTraceparent } from '@/lib/trace';

// Node.js runtime: HMAC verify + posthog-node + OTLP exporter are node modules.
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = withApiRoute(
  {
    route: 'webhooks.anthropic',
    feature: 'webhooks',
    errorResponse(error) {
      const webhookError = toWebhookError(error);
      return Response.json(
        { error: { code: webhookError.code, message: ROUTE_ERROR_MESSAGES[webhookError.code] } },
        { status: httpStatusForWebhookError(webhookError) },
      );
    },
  },
  async (request) => {
    // Anthropic echoes our traceparent so webhook work joins the original trace.
    extend({
      trace_id: parseTraceparent(request.headers.get('traceparent')) ?? requireCtx().trace_id,
    });
    // The secret is optional so builds can run without webhook configuration.
    const secret = anthropicWebhookSecret();
    extend({
      webhookSource: 'anthropic',
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
    const event = parseAnthropicWebhook(body, headers, secret);
    await routeAnthropicEvent(event);
    shipLog({
      msg: 'webhook.handled',
      feature: 'webhooks',
      op: 'anthropic',
      event_type: event.data.type,
      event_id: event.id,
    });

    return Response.json({ ok: true });
  },
);
