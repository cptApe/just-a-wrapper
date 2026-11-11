// Local-development sign-in shortcut. Navigating here (or clicking the
// dev-only button on /login) signs you in as DEV_AUTH_EMAIL and lands on /app,
// skipping the email-OTP inbox round-trip while iterating on authenticated UI.
//
// It is NOT a backdoor: it runs the genuine passwordless flow — generate an
// OTP, then verify it — so the user, session, and workspace are provisioned
// exactly as a normal sign-in. Triple-gated to local dev only; see
// src/lib/dev-auth.ts. Any gate miss → 404, so the route does not exist in any
// deployed environment.

import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { safeReturnTo } from '@/features/auth/lib/return-to';
import { ensurePersonalWorkspace } from '@/features/workspaces/api/ensure-personal-workspace';
import { auth } from '@/lib/auth';
import { DEV_AUTH_EMAIL, DEV_AUTH_ENABLED, isLocalRequest, takeDevOtp } from '@/lib/dev-auth';
import { AppError } from '@/lib/errors';
import { withApiRoute } from '@/lib/route-kit';

export const runtime = 'nodejs';

export function GET(request: Request) {
  if (!DEV_AUTH_ENABLED || !isLocalRequest(request)) notFound();
  return withApiRoute({ route: 'api/dev/login', feature: 'auth' }, async () => {
    const requestUrl = new URL(request.url);
    const emailParam = requestUrl.searchParams.get('email')?.trim().toLowerCase();
    const email = emailParam?.includes('@') ? emailParam : DEV_AUTH_EMAIL;
    // Honor a captured returnTo so the dev shortcut round-trips a deep
    // link the same as a real sign-in; validated same-origin, else /app.
    const returnTo = safeReturnTo(requestUrl.searchParams.get('returnTo'));
    const requestHeaders = await headers();

    // Generate the OTP (captured in-memory by the auth config's dev branch)…
    await auth.api.sendVerificationOTP({
      body: { email, type: 'sign-in' },
      headers: requestHeaders,
    });
    const otp = takeDevOtp(email);
    if (!otp) {
      throw new AppError('UNEXPECTED', 'dev-login: OTP was not captured', { email });
    }
    // …then verify it. nextCookies() copies the session cookie onto the
    // response, so the browser is signed in after this redirect resolves.
    await auth.api.signInEmailOTP({ body: { email, otp }, headers: requestHeaders });

    // A fresh session carries no active organization. The (shell) layout would
    // normally derive it via ensurePersonalWorkspace, but its setActiveOrganization
    // write is dropped during RSC render (Next can't set cookies there), so
    // resolveCaller 404s on org-keyed routes (e.g. /app/scheduled) until
    // a manual set-active POST. We're in a route handler, where cookie writes DO
    // persist — so provision the personal org and stamp it active now. The new
    // session cookie was just written into Next's jar by nextCookies(); forward it
    // so ensurePersonalWorkspace resolves this session rather than the anonymous one.
    const authedHeaders = new Headers(requestHeaders);
    authedHeaders.set(
      'cookie',
      (await cookies())
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; '),
    );
    await ensurePersonalWorkspace(authedHeaders);

    // Land on the captured destination when present, else /app.
    return Response.redirect(new URL(returnTo ?? '/app', request.url), 307);
  })(request);
}
