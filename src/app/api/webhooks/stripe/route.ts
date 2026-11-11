import { processStripeWebhook } from '@/features/billing';
import { AppError } from '@/lib/errors';
import { routeErrorResponse, withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
export const POST = withApiRoute(
  {
    route: 'api/webhooks/stripe',
    feature: 'billing',
    reportExpectedErrors: true,
    errorResponse(error) {
      // Fulfillment failures remain retryable even when their ordinary API status is 4xx.
      const status =
        error instanceof AppError && error.code === 'WEBHOOK_SIGNATURE_INVALID' ? 400 : 500;
      const response = routeErrorResponse(error);
      return new Response(response.body, { status, headers: response.headers });
    },
  },
  async (request) => {
    // Signature verification needs the exact request bytes, not parsed and serialized JSON.
    const delivery = await processStripeWebhook(
      await request.text(),
      request.headers.get('stripe-signature'),
    );
    return Response.json(delivery.body, { status: delivery.status });
  },
);
