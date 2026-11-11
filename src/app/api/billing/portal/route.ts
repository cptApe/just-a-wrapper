import { headers } from 'next/headers';
import { createPortalSession, requireBillingAdmin } from '@/features/billing';
import { env } from '@/lib/env';
import { AppError, PortalUnavailableError } from '@/lib/errors';
import { routeErrorResponse, withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

export const GET = withApiRoute(
  {
    route: 'api/billing/portal',
    feature: 'billing',
    reportExpectedErrors: true,
    errorResponse(error) {
      // Only portal creation failures return to billing; authorization failures retain their status.
      if (!(error instanceof PortalUnavailableError)) return routeErrorResponse(error);
      return Response.redirect(
        `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing?portal=unavailable`,
        303,
      );
    },
  },
  async () => {
    const workspace = await requireBillingAdmin(await headers()).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'UNAUTHENTICATED') return null;
      throw error;
    });
    if (!workspace) return Response.redirect(`${env.NEXT_PUBLIC_APP_URL}/login`, 303);
    const { url } = await createPortalSession({ workspace });
    return Response.redirect(url, 303);
  },
);
