// Soft TTL for a cached Tool Router URL. Composio sessions persist and do not expire,
// so past it the proxy re-mints proactively; an upstream auth failure re-mints at any age.
const TOOL_ROUTER_URL_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const replacements = new Map<string, { rejectedUrls: ReadonlySet<string>; url: string }>();

// A minted-at timestamp is stale once it is at/over the TTL old. A null
// minted-at (never minted) is always stale.
export function isStale(mintedAtMs: number | null, nowMs: number): boolean {
  if (mintedAtMs === null) {
    return true;
  }
  return nowMs - mintedAtMs >= TOOL_ROUTER_URL_TTL_MS;
}

// Remember which rejected URLs a recovery replaced, for auth failures that arrive after it ends.
export function recordReplacement(
  memberId: string,
  rejectedUrls: ReadonlySet<string>,
  url: string,
): void {
  const previous = replacements.get(memberId);
  // A recovery that reuses an earlier replacement must not forget what that one replaced.
  const earlierRejectedUrls = previous?.url === url ? previous.rejectedUrls : [];
  replacements.set(memberId, {
    rejectedUrls: new Set([...earlierRejectedUrls, ...rejectedUrls]),
    url,
  });
}

export function replacementFor(memberId: string, rejectedUrl: string): string | null {
  const replacement = replacements.get(memberId);
  // A waiter can reject the very URL a recovery produced, which is no replacement.
  return replacement?.rejectedUrls.has(rejectedUrl) && replacement.url !== rejectedUrl
    ? replacement.url
    : null;
}
