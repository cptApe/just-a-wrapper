import { lookup as dnsLookup } from 'node:dns/promises';
import { ToolError } from '@/lib/errors';

// SSRF guard for server-side URL handling. Browser navigation can use the
// synchronous literal check; server-side fetches must use assertPublicTarget
// so current DNS answers are checked too.
// The page loaded by `browse_page` runs on
// Browserbase's network, so an attacker-supplied URL must never reach a
// loopback / private / link-local host (which fronts cloud metadata at
// 169.254.169.254) or a non-web scheme (file://, an internal service).

// Hostnames that always resolve to the local machine.
const BLOCKED_HOST_NAMES = new Set(['localhost']);

/**
 * Reason a URL must not be browsed, or null when it is a safe public http(s)
 * target. This synchronous helper is literal-IP based; server-side fetches must
 * additionally call assertPublicTarget to resolve and inspect DNS answers.
 */
export function blockedTargetReason(rawUrl: string): string | null {
  if (!URL.canParse(rawUrl)) return 'not a valid URL';
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'only http and https URLs are allowed';
  }
  // Strip IPv6 brackets; lowercase for the name check.
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOST_NAMES.has(host) || host.endsWith('.localhost')) {
    return 'that host is not allowed';
  }
  if (isBlockedIp(host)) return 'that host is not allowed';
  return null;
}

/** True for loopback / private / link-local literal IPs (v4 and common v6). */
function isBlockedIp(host: string): boolean {
  // IPv6 checks apply ONLY to IPv6 literals (they contain a colon). Without this
  // gate, the `fc`/`fd` unique-local prefixes match ordinary hostnames like
  // fda.gov and fcbarcelona.com and wrongly block them.
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true;
    const firstGroup = Number.parseInt(host.split(':')[0] ?? '', 16);
    if (
      (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) ||
      (firstGroup >= 0xfc00 && firstGroup <= 0xfdff)
    )
      return true;
  }
  const v4 = ipv4FromHost(host);
  if (!v4) return false;
  const [a, b, c] = v4;
  if (a === 127 || a === 10 || a === 0) return true; // loopback, private, this-host
  if (a === 100 && b >= 64 && b <= 127) return true; // shared/CGNAT, including metadata
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // protocol + TEST-NET-1
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true; // benchmark + TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved
  return false;
}

type LookupAddress = { address: string; family: number };
type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

/**
 * Assert that a server-side fetch target resolves only to public addresses.
 * DNS can still rebind between this lookup and the socket connection; callers
 * must repeat this check for every redirect and keep redirects manual.
 */
export async function assertPublicTarget(
  rawUrl: string | URL,
  lookup: LookupAll = dnsLookup,
): Promise<URL> {
  const value = rawUrl.toString();
  const blocked = blockedTargetReason(value);
  if (blocked) {
    throw new ToolError('TOOL_INPUT_INVALID', 'The source URL must target a public host', {
      url: value,
      reason: blocked,
    });
  }
  const url = new URL(value);
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch (cause) {
    throw new ToolError(
      'TOOL_INPUT_INVALID',
      'The source URL host could not be resolved',
      { url: value },
      { cause },
    );
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new ToolError('TOOL_INPUT_INVALID', 'The source URL must target a public host', {
      url: value,
      reason: 'that host resolves to a non-public address',
    });
  }
  return url;
}

/**
 * The four IPv4 octets of `host`, or null if it isn't IPv4 in any recognized
 * form. Handles dotted-quad and the IPv4-mapped IPv6 forms that URL parsing
 * normalizes to — dotted (::ffff:127.0.0.1) OR hex (::ffff:7f00:1, which is how
 * Node's URL emits it).
 */
function ipv4FromHost(host: string): [number, number, number, number] | null {
  const mapped = host.startsWith('::ffff:') ? host.slice(7) : host;
  if (mapped.includes('.')) {
    const octets = mapped.split('.');
    if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) return null;
    const nums = octets.map((o) => Number(o));
    if (nums.some((n) => n > 255)) return null;
    const first = nums.at(0);
    const second = nums.at(1);
    const third = nums.at(2);
    const fourth = nums.at(3);
    if (first === undefined || second === undefined || third === undefined || fourth === undefined)
      return null;
    return [first, second, third, fourth];
  }
  // Hex form: two 16-bit groups carry the four octets (h1 = high half, h2 = low).
  if (mapped === host) return null; // not an ::ffff: mapping and not dotted → not v4
  const groups = mapped.split(':');
  if (groups.length !== 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const halves = groups.map((g) => Number.parseInt(g, 16));
  const h1 = halves.at(0),
    h2 = halves.at(1);
  if (h1 === undefined || h2 === undefined) return null;
  return [(h1 >> 8) & 0xff, h1 & 0xff, (h2 >> 8) & 0xff, h2 & 0xff];
}
