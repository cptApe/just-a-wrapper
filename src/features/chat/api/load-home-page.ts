import { headers } from 'next/headers';
import { getBillingSummary, getCycleCreditsUsed } from '@/features/billing';
import { resolveEffectiveTimeZone } from '@/features/preferences/lib/time-preferences';
import { ensureRequestOrganization } from '@/features/workspaces/api/ensure-request-organization';
import { getWorkspaceName } from '@/features/workspaces/api/get-workspace-name';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';
import { capabilities } from '@/lib/runtime-capabilities';
import 'server-only';
import { buildGreeting } from '../lib/greeting';
import { loadPageUploadConfig } from './load-page-upload-config';

export async function loadHomePage() {
  return withRequestContext({ route: 'app-home' }, async () => {
    const requestHeaders = await headers();
    const session = await getRequestSession();
    if (!session) throw new AppError('UNAUTHENTICATED', 'Sign in to open Home.');
    // A new session has no active workspace until the gate provisions one, and this
    // page renders alongside that gate. Only a workspace lost after resolving is missing.
    const organizationId = await ensureRequestOrganization();
    const workspaceName = await getWorkspaceName(organizationId);
    const timeZone = resolveEffectiveTimeZone(
      {
        timezone: session.user.timezone,
        browserTimezone: session.user.browserTimezone,
      },
      logger(),
    );
    const greeting = buildGreeting({ name: session.user.name, now: new Date(), timeZone });
    if (workspaceName === null) return { kind: 'missing-workspace' as const, greeting };
    const [billing, { workspaceId }, config] = await Promise.all([
      capabilities.billing.kind === 'stripe' ? loadHomeBilling(requestHeaders) : null,
      resolveCaller(requestHeaders),
      loadPageUploadConfig(),
    ]);
    return {
      kind: 'ready' as const,
      organizationId,
      greeting,
      billing,
      attach: { workspaceId, uploadConfig: config },
    };
  });
}

// A failed billing read costs Home its credits chip, never the page itself.
async function loadHomeBilling(requestHeaders: Headers) {
  try {
    const summary = await getBillingSummary(requestHeaders);
    return {
      creditBalance: summary.creditBalance,
      isSubscribed: summary.isSubscribed,
      planTier: summary.planTier,
      planCreditsExpireAt: summary.planCreditsExpireAt,
      creditsUsedThisCycle: await getCycleCreditsUsed(summary.workspaceId, summary.creditResetAt),
    };
  } catch (error) {
    captureException(error, { op: 'home-billing' });
    return null;
  }
}
