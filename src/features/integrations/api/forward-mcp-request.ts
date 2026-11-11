import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { member, user, workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { IntegrationError } from '@/lib/errors';
import { extend } from '@/lib/request-context';
import { mintToolRouterSession } from '../composio/tool-router';
import { bearerFromHeader, verifyMemberToken } from '../jwt';
import { isStale, recordReplacement, replacementFor } from '../tool-router-replacements';
import type { ProxyConfig } from './proxy-config';
import { resolveSessionPins } from './shared-connections';
import { persistMintedUrl } from './tool-router-transitions';

async function loadMember(
  memberId: string,
): Promise<
  Pick<
    typeof workspaceMember.$inferSelect,
    | 'composioUserId'
    | 'organizationId'
    | 'toolRouterUrl'
    | 'toolRouterMintedAt'
    | 'toolRouterGeneration'
  >
> {
  const rows = await db
    .select({
      composioUserId: workspaceMember.composioUserId,
      organizationId: workspaceMember.organizationId,
      toolRouterUrl: workspaceMember.toolRouterUrl,
      toolRouterMintedAt: workspaceMember.toolRouterMintedAt,
      toolRouterGeneration: workspaceMember.toolRouterGeneration,
    })
    .from(workspaceMember)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, workspaceMember.organizationId),
        eq(member.userId, workspaceMember.userId),
      ),
    )
    .innerJoin(user, and(eq(user.id, workspaceMember.userId), isNull(user.deletedAt)))
    .innerJoin(
      workspace,
      and(eq(workspace.organizationId, workspaceMember.organizationId), workspaceNotDeleted),
    )
    .where(eq(workspaceMember.composioUserId, memberId))
    .limit(1);
  const row = rows.at(0);
  if (!row) {
    // Removing a member revokes their token without rotating the global signing key.
    throw new IntegrationError('INTEGRATION_NOT_CONNECTED', 'no live member for proxy token', {
      memberId,
    });
  }
  return row;
}

// Concurrent MCP clients for one member (for example the Apps connection read
// and vault-health initialize probe) share one resolution. This map exists
// only for single-flight; the member row holds the settled URL.
type InFlightResolution =
  | { mode: 'normal'; promise: Promise<string> }
  | { mode: 'forced'; promise: Promise<string>; rejectedUrls: Set<string> };
const resolutionInFlight = new Map<string, InFlightResolution>();

type ResolutionRequest = { mode: 'normal' } | { mode: 'forced'; rejectedUrl: string };

// The entry leaves the map as part of its own promise, so anyone who observes
// the settled promise also observes the slot as free.
function registerResolution(
  memberId: string,
  work: Promise<string>,
  kind: { mode: 'normal' } | { mode: 'forced'; rejectedUrls: Set<string> },
): Promise<string> {
  const promise: Promise<string> = work.finally(() => {
    if (resolutionInFlight.get(memberId)?.promise === promise) {
      resolutionInFlight.delete(memberId);
    }
  });
  resolutionInFlight.set(memberId, { ...kind, promise });
  return promise;
}

// Resolve the member's Tool Router URL; a forced request names the URL that
// failed upstream auth. The map is read and written before the first await, and
// every database read happens inside the shared promise. A check split across
// an await lets two requests both find the slot empty, and lets a row read
// before a concurrent mint decide what happens after that mint.
function resolveToolRouterUrl(
  memberId: string,
  config: ProxyConfig,
  nowMs: number,
  request: ResolutionRequest,
): Promise<string> {
  const existing = resolutionInFlight.get(memberId);
  if (request.mode === 'normal') {
    if (existing) return existing.promise;
    return registerResolution(memberId, resolveFromMemberRow(memberId, config, nowMs), {
      mode: 'normal',
    });
  }

  const { rejectedUrl } = request;
  if (existing?.mode === 'forced') {
    return joinRecovery(memberId, config, nowMs, existing, rejectedUrl);
  }

  // A forced recovery serializes behind any ordinary resolution already in
  // flight. It can reuse that resolution only when it produced a URL no waiter
  // rejected; otherwise it force-mints. While queued/running it is the member's
  // shared resolution, so new ordinary requests cannot overlap it or hand out
  // the rejected URL.
  const rejectedUrls = new Set([rejectedUrl]);
  const recover = () => recoverToolRouterUrl(memberId, config, nowMs, rejectedUrl);
  const work = existing
    ? existing.promise.then((url) => (rejectedUrls.has(url) ? recover() : url), recover)
    : recover();
  return registerResolution(
    memberId,
    work.then((url) => {
      recordReplacement(memberId, rejectedUrls, url);
      return url;
    }),
    { mode: 'forced', rejectedUrls },
  );
}

// A waiter can know the shared result is bad even when it was valid for the
// caller that created the entry. It starts one replacement, and concurrent
// waiters with the same knowledge join that replacement.
async function joinRecovery(
  memberId: string,
  config: ProxyConfig,
  nowMs: number,
  recovery: Extract<InFlightResolution, { mode: 'forced' }>,
  rejectedUrl: string,
): Promise<string> {
  recovery.rejectedUrls.add(rejectedUrl);
  const sharedUrl = await recovery.promise;
  if (sharedUrl !== rejectedUrl) return sharedUrl;
  return resolveToolRouterUrl(memberId, config, nowMs, { mode: 'forced', rejectedUrl });
}

async function resolveFromMemberRow(
  memberId: string,
  config: ProxyConfig,
  nowMs: number,
): Promise<string> {
  const currentMember = await loadMember(memberId);
  if (
    currentMember.toolRouterUrl &&
    !isStale(currentMember.toolRouterMintedAt?.getTime() ?? null, nowMs)
  ) {
    return currentMember.toolRouterUrl;
  }
  return mintAndPersistUrl(memberId, currentMember, config, nowMs);
}

// An auth failure can arrive just after a recovery finished, still naming the
// URL that recovery replaced. Minting again would discard a good URL. A URL
// that merely differs from the rejected one proves nothing: this request may
// have no knowledge of how the row reached its current value.
async function recoverToolRouterUrl(
  memberId: string,
  config: ProxyConfig,
  nowMs: number,
  rejectedUrl: string,
): Promise<string> {
  const currentMember = await loadMember(memberId);
  const replacement = replacementFor(memberId, rejectedUrl);
  if (
    replacement !== null &&
    replacement === currentMember.toolRouterUrl &&
    !isStale(currentMember.toolRouterMintedAt?.getTime() ?? null, nowMs)
  ) {
    return replacement;
  }
  return mintAndPersistUrl(memberId, currentMember, config, nowMs);
}

// A mint that loses to another mint uses the winner's URL. One that loses to a clear
// mints once more from the cleared row, so the pins match the change that cleared it.
async function mintAndPersistUrl(
  memberId: string,
  member: Awaited<ReturnType<typeof loadMember>>,
  config: ProxyConfig,
  nowMs: number,
  attempt = 1,
): Promise<string> {
  const minted = await mintToolRouterSession(
    member.composioUserId,
    config.composioApiKey,
    await resolveSessionPins(member, config.composioApiKey),
  );
  const moved = await persistMintedUrl({
    memberId,
    url: minted.mcpUrl,
    mintedAt: new Date(nowMs),
    generation: member.toolRouterGeneration,
  });
  if (moved) return minted.mcpUrl;
  const winner = await loadMember(memberId);
  if (winner.toolRouterUrl !== null) return winner.toolRouterUrl;
  if (attempt < 2) return mintAndPersistUrl(memberId, winner, config, nowMs, attempt + 1);
  throw new IntegrationError(
    'INTEGRATION_NOT_CONNECTED',
    'Tool router cache cleared while minting',
    {
      memberId,
    },
  );
}

// Build the upstream request headers from the inbound request + config. The
// inbound Authorization Bearer is deliberately NOT copied — Composio authenticates
// with OUR x-api-key, never the caller's token.
function buildUpstreamHeaders(inbound: Request, config: ProxyConfig): Headers {
  const headers = new Headers();
  // Mirror the inbound MCP content negotiation; default to both per the spec.
  headers.set('content-type', inbound.headers.get('content-type') ?? 'application/json');
  headers.set('accept', inbound.headers.get('accept') ?? 'application/json, text/event-stream');
  // Composio authenticates with OUR key — injected here, never the inbound Bearer.
  headers.set('x-api-key', config.composioApiKey);
  // Pass the MCP transport session id through if the client sent one.
  const sessionId = inbound.headers.get('mcp-session-id');
  if (sessionId) {
    headers.set('mcp-session-id', sessionId);
  }
  return headers;
}

function postUpstream(
  url: string,
  body: string,
  inbound: Request,
  config: ProxyConfig,
  transport: 'preserve' | 'reset',
): Promise<Response> {
  const headers = buildUpstreamHeaders(inbound, config);
  if (transport === 'reset') headers.delete('mcp-session-id');
  return fetch(url, {
    method: 'POST',
    headers,
    body,
  });
}

export async function forwardMcpRequest(request: Request, config: ProxyConfig): Promise<Response> {
  const memberId = await verifyMemberToken(
    bearerFromHeader(request.headers.get('authorization')),
    config.jwtSecret,
  );
  // Enrich the request context so logs/captures carry the resolved member.
  extend({ feature: 'integrations', op: 'mcp-proxy', user_id: memberId });

  // The JSON-RPC body is opaque to us — read it once as text and forward as-is.
  const bodyText = await request.text();

  const firstUrl = await resolveToolRouterUrl(memberId, config, Date.now(), { mode: 'normal' });
  await loadMember(memberId);
  let upstream = await postUpstream(firstUrl, bodyText, request, config, 'preserve');

  // An upstream 401/403 means the stored URL's session was revoked or is
  // otherwise unusable, so re-mint once and retry.
  if (upstream.status === 401 || upstream.status === 403) {
    const retryUrl = await resolveToolRouterUrl(memberId, config, Date.now(), {
      mode: 'forced',
      rejectedUrl: firstUrl,
    });
    await loadMember(memberId);
    upstream = await postUpstream(retryUrl, bodyText, request, config, 'reset');
  }

  const headers = new Headers({ 'cache-control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) {
    headers.set('content-type', contentType);
  }
  const sessionId = upstream.headers.get('mcp-session-id');
  if (sessionId) {
    headers.set('mcp-session-id', sessionId);
  }
  // Stream the upstream body straight back — no re-buffering, no MCP re-framing.
  return new Response(upstream.body, { status: upstream.status, headers });
}
