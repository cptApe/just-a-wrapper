import 'server-only';
import { headers } from 'next/headers';
import { loginUrlWithReturnTo, PATHNAME_HEADER } from './return-to';

// Server-side capture half of the returnTo round-trip. A gate that finds
// no session calls `redirect(await loginRedirectUrl)` — returning the URL (not
// calling redirect here) keeps redirect's `never` return at the call site so
// TypeScript still narrows the session as non-null after the guard.

/**
 * The /login URL to send a signed-out visitor to, preserving the requested path
 * (read from the proxy-stamped `x-pathname` header, validated by safeReturnTo).
 * Falls back to a plain /login when there is no safe path.
 */
export async function loginRedirectUrl(): Promise<string> {
  const path = (await headers()).get(PATHNAME_HEADER);
  return loginUrlWithReturnTo(path);
}
