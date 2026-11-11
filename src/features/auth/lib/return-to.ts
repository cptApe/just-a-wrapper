// Capture the intended destination in returnTo and validate it before redirecting.
// Accept same-origin absolute paths only: reject protocol-relative hosts, backslashes,
// schemes and control/whitespace smuggling. Invalid values use the default destination.

/** The query parameter carrying the intended post-login destination. */
export const RETURN_TO_PARAM = 'returnTo';

/**
 * Request header the proxy (src/proxy.ts) stamps with the requested path+search,
 * so a server-side auth gate can read where the visitor was headed. Next gives
 * server components no other access to the current pathname.
 */
export const PATHNAME_HEADER = 'x-pathname';

// Control chars (0x00-0x1f), space (0x20), and DEL (0x7f). A legitimate path
// percent-encodes any of these, so a raw occurrence is an injection attempt.
const CONTROL_OR_SPACE = /[\x00-\x20\x7f]/;

/**
 * Return `raw` only when it is a safe same-origin relative path, else null.
 * Same validator on both sides of the round-trip (capture and consume).
 */
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // A URL or scheme (`https://`, `javascript:`, `mailto:`) never starts with `/`.
  if (!raw.startsWith('/')) return null;
  // Protocol-relative `//evil.com` is same-slash but cross-origin.
  if (raw.startsWith('//')) return null;
  // Backslashes let `/\evil.com` read as protocol-relative in browsers.
  if (raw.includes('\\')) return null;
  // Control chars / raw whitespace can smuggle a second target past the checks above.
  if (CONTROL_OR_SPACE.test(raw)) return null;
  return raw;
}

/**
 * Build the /login URL that preserves `path` as the post-login destination.
 * `path` is validated here, so a gate can pass the raw current path and trust the
 * result: an unsafe or absent path yields a plain /login.
 */
export function loginUrlWithReturnTo(path: string | null | undefined): string {
  const safe = safeReturnTo(path);
  return safe ? `/login?${RETURN_TO_PARAM}=${encodeURIComponent(safe)}` : '/login';
}
