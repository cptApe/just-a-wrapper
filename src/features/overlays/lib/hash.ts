import type { ParsedOverlay } from '../types';
import { OVERLAY_TOKENS, type OverlayHash, type OverlayToken } from './tokens';

// Parse #<token>[/<id>][?<params>] without browser APIs.
// The registry decides whether a two-segment path is itself a token.

// Unknown links leave the bare page usable. Match the longest token so foo/new wins over foo with id new.
export function parseOverlayHash<Token extends string>(
  rawHash: string,
  knownTokens: readonly Token[],
): ParsedOverlay<Token> | null {
  const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (hash === '') return null;

  const queryStart = hash.indexOf('?');
  const pathPart = queryStart === -1 ? hash : hash.slice(0, queryStart);
  const queryPart = queryStart === -1 ? '' : hash.slice(queryStart + 1);

  const segments = pathPart.split('/').map(decodeSegment);
  if (segments.some((s) => s === '')) return null;

  const sortedTokens = [...knownTokens].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const token of sortedTokens) {
    const tokenSegments = token.split('/');
    if (segments.length < tokenSegments.length) continue;
    if (!tokenSegments.every((seg, i) => segments[i] === seg)) continue;
    const rest = segments.slice(tokenSegments.length);
    // At most one trailing segment (the id); deeper paths are not in the grammar.
    if (rest.length > 1) return null;
    return {
      token,
      id: rest.at(0) ?? null,
      params: new URLSearchParams(queryPart),
    };
  }
  return null;
}

/** Narrows a hash read from an href to one the overlay grammar accepts. */
export function isOverlayHash(hash: string): hash is OverlayHash {
  return parseOverlayHash(hash, OVERLAY_TOKENS) !== null;
}

// Malformed escapes must not crash a deep link. URLSearchParams tolerates them; escape query separators first.
function decodeSegment(segment: string): string {
  const escaped = segment.replace(
    /[+&=]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return new URLSearchParams(`v=${escaped}`).get('v') ?? '';
}

/** Build a hash (no leading '#') for a token, e.g.
    buildOverlayHash('file', id, { in: '/Reports', tab: 'all' }). */
export function buildOverlayHash(
  token: OverlayToken,
  id?: string | null,
  params?: Record<string, string>,
): OverlayHash {
  const query = new URLSearchParams(params).toString();
  if (id)
    return query === ''
      ? `${token}/${encodeURIComponent(id)}`
      : `${token}/${encodeURIComponent(id)}?${query}`;
  return query === '' ? token : `${token}?${query}`;
}
