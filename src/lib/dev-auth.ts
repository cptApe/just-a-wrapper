// Local-development sign-in shortcut — skip the email-OTP round-trip while
// iterating on authenticated UI. It drives the REAL passwordless flow (the
// OTP is generated and verified server-side); it does not forge sessions or
// bypass Better Auth's internals.
//
// SAFETY — this can NEVER run in a deployed/production environment. It is gated
// three independent ways, all of which must hold:
//   1. process.env.NODE_ENV !== 'production' — OR the server-only
//      DEV_AUTH_ALLOW_LOCAL_PROD === 'true' escape hatch, which exists for
//      LOCAL `next start` builds. `next build`, `next start`, and
//      Vercel all force NODE_ENV='production'; only `next dev` is
//      'development'. Deployed environments never set the escape hatch, so for
//      them this gate is still NODE_ENV alone.
//   2. NEXT_PUBLIC_ENABLE_DEV_ROUTES === 'true' — the same explicit opt-in every
//      other /dev route uses ('false' by default).
//   3. The request must originate from localhost (checked at the route).
// The OTP capture below only retains anything while (1)+(2) hold.

import { env } from '@/lib/env';

/** True under `next dev` — or a local prod build that explicitly opted in —
 *  with dev routes explicitly enabled. */
export const DEV_AUTH_ENABLED =
  (process.env.NODE_ENV !== 'production' || env.DEV_AUTH_ALLOW_LOCAL_PROD === 'true') &&
  env.NEXT_PUBLIC_ENABLE_DEV_ROUTES === 'true';

/** The identity the shortcut signs in as when no ?email is given. */
export const DEV_AUTH_EMAIL = 'dev@agentcore.local';

// Most-recent OTP per email, written by the auth config's sendVerificationOTP
// callback (only when DEV_AUTH_ENABLED) and consumed once by dev-login.
// In-memory only, never persisted, expires after five minutes.
const devOtpStore = new Map<string, { otp: string; expiresAt: number }>();

/** Record a freshly generated OTP so the dev-login route can complete sign-in. */
export function captureDevOtp(email: string, otp: string): void {
  if (!DEV_AUTH_ENABLED) return;
  const now = Date.now();
  for (const [key, entry] of devOtpStore) {
    if (entry.expiresAt <= now) devOtpStore.delete(key);
  }
  devOtpStore.set(email.toLowerCase(), { otp, expiresAt: now + 300_000 });
}

/** Read and clear the captured OTP for an email. */
export function takeDevOtp(email: string): string | undefined {
  const key = email.toLowerCase();
  const captured = devOtpStore.get(key);
  devOtpStore.delete(key);
  return captured && captured.expiresAt > Date.now() ? captured.otp : undefined;
}

/** Defense-in-depth: the dev-login request must come from the local machine. */
export function isLocalRequest(request: Request): boolean {
  const hostname = (request.headers.get('host') ?? '').split(':').at(0)?.toLowerCase() ?? '';
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
