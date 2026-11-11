// The MCP proxy on real member rows: who may reach Composio through it and how a rejected router URL is replaced.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { member, workspace, workspaceMember } from '@/db/schema';
import { forwardMcpRequest } from '@/features/integrations/api/forward-mcp-request';
import { signMemberToken } from '@/features/integrations/jwt';
import { withRequestContext } from '@/lib/request-context';
import { requiredRow } from './helpers/required-row';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const config = {
  jwtSecret: 'proxy-test-secret-with-at-least-32-characters',
  composioApiKey: 'test-key',
};
// Recovery history lives in the process and is keyed by member, so each test needs its own.
let memberId: string;
const storedUrl = 'https://router.example/stored';
const mintedUrl = 'https://router.example/minted';
let token: string;

beforeAll(async () => {
  await applyMigrations(database);
});
beforeEach(async () => {
  await truncateAll(database);
  memberId = `proxy-member-${randomUUID()}`;
  await seedUser(database, 'proxy-user');
  await seedOrganization(database, 'proxy-org');
  await database.insert(workspace).values({ organizationId: 'proxy-org', name: 'Proxy workspace' });
  await database.insert(member).values({
    id: 'proxy-membership',
    organizationId: 'proxy-org',
    userId: 'proxy-user',
    role: 'owner',
    createdAt: new Date(),
  });
  await database
    .insert(workspaceMember)
    .values({ organizationId: 'proxy-org', userId: 'proxy-user', composioUserId: memberId });
  token = await signMemberToken(memberId, config.jwtSecret);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await pool.end();
});

function forward(authorization: string | null = `Bearer ${token}`, onBodyRead?: () => void) {
  const headers = new Headers({
    'content-type': 'application/json',
    'mcp-session-id': 'transport-session',
  });
  if (authorization !== null) headers.set('authorization', authorization);
  const request = new Request('https://proxy.example/mcp', {
    method: 'POST',
    headers,
    body: '{"jsonrpc":"2.0","id":1}',
  });
  if (onBodyRead) {
    const read = request.text.bind(request);
    vi.spyOn(request, 'text').mockImplementation(async () => {
      const body = await read();
      onBodyRead();
      return body;
    });
  }
  return withRequestContext({ route: 'test-mcp-proxy' }, () => forwardMcpRequest(request, config));
}

async function storeUrl(url: string, mintedAt: Date) {
  await database
    .update(workspaceMember)
    .set({ toolRouterUrl: url, toolRouterMintedAt: mintedAt })
    .where(eq(workspaceMember.composioUserId, memberId));
}

function mockUpstream(status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).endsWith('/tool_router/session'))
      return Response.json({ session_id: 'session-1', mcp: { url: mintedUrl } });
    return new Response('upstream body', {
      status,
      headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'upstream-session' },
    });
  });
}

test.each([
  null,
  'Bearer invalid-token',
])('a missing or forged token (%s) is refused before any network call', async (authorization) => {
  const fetch = mockUpstream();
  await expect(forward(authorization)).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { case: 'its workspace member row is gone', remove: () => database.delete(workspaceMember) },
  { case: 'its organization membership is gone', remove: () => database.delete(member) },
])('a valid token is refused before any network call when $case', async ({ remove }) => {
  await storeUrl(storedUrl, new Date());
  await remove();
  const fetch = mockUpstream();
  await expect(forward()).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED' });
  expect(fetch).not.toHaveBeenCalled();
});

test("a first request mints and stores the member's router URL and never forwards the member token upstream", async () => {
  const fetch = mockUpstream();
  const response = await forward();
  const member = requiredRow((await database.select().from(workspaceMember)).at(0));
  expect(member.toolRouterUrl).toBe(mintedUrl);
  expect(member.toolRouterMintedAt).toBeInstanceOf(Date);
  const [, options] = requiredRow(fetch.mock.calls.at(1));
  const headers = new Headers(options?.headers);
  expect(headers.get('authorization')).toBeNull();
  expect(headers.get('x-api-key')).toBe(config.composioApiKey);
  expect(headers.get('mcp-session-id')).toBe('transport-session');
  expect(options?.body).toBe('{"jsonrpc":"2.0","id":1}');
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  expect(response.headers.get('mcp-session-id')).toBe('upstream-session');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).toBe('upstream body');
});

test('a fresh stored URL is used without minting a new one', async () => {
  await storeUrl(storedUrl, new Date());
  const fetch = mockUpstream();
  expect((await forward()).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(requiredRow(fetch.mock.calls.at(0)).at(0)).toBe(storedUrl);
});

test('concurrent first requests share one mint', async () => {
  const fetch = mockUpstream();
  const responses = await Promise.all([forward(), forward(), forward()]);
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
  expect(
    fetch.mock.calls.filter(([url]) => String(url).endsWith('/tool_router/session')),
  ).toHaveLength(1);
});

test.each([
  401, 403,
])('an upstream %s remints once and retries without the old transport session', async (status) => {
  await storeUrl(storedUrl, new Date());
  const fetch = mockUpstream(status);
  expect((await forward()).status).toBe(status);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    storedUrl,
    'https://backend.composio.dev/api/v3.1/tool_router/session',
    mintedUrl,
  ]);
  const [, retry] = requiredRow(fetch.mock.calls.at(2));
  expect(new Headers(retry?.headers).get('mcp-session-id')).toBeNull();
});

test('concurrent rejections of the stored URL share one remint', async () => {
  await storeUrl(storedUrl, new Date());
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === storedUrl) return new Response(null, { status: 401 });
    if (String(input).endsWith('/tool_router/session'))
      return Response.json({ session_id: 'session-1', mcp: { url: mintedUrl } });
    return new Response('ok');
  });
  expect((await Promise.all([forward(), forward()])).map((response) => response.status)).toEqual([
    200, 200,
  ]);
  expect(
    fetch.mock.calls.filter(([url]) => String(url).endsWith('/tool_router/session')),
  ).toHaveLength(1);
});

test('a failed mint is not cached, so the next request can succeed', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(forward()).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
  fetch.mockRestore();
  mockUpstream();
  expect((await forward()).status).toBe(200);
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function mintedResponse(url: string) {
  return Response.json({ session_id: 'session-1', mcp: { url } });
}

test('a recovery accepts a different URL minted by a concurrent normal request', async () => {
  await storeUrl(storedUrl, new Date());
  const staleResponse = deferred<Response>();
  const staleStarted = deferred<void>();
  const mint = deferred<Response>();
  const mintStarted = deferred<void>();
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === storedUrl) {
      staleStarted.resolve();
      return staleResponse.promise;
    }
    if (String(input).endsWith('/tool_router/session')) {
      mintStarted.resolve();
      return mint.promise;
    }
    return new Response('ok');
  });
  const recovery = forward();
  await staleStarted.promise;
  await database.update(workspaceMember).set({ toolRouterUrl: null, toolRouterMintedAt: null });
  const normal = forward();
  await mintStarted.promise;
  staleResponse.resolve(new Response(null, { status: 401 }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  mint.resolve(mintedResponse(mintedUrl));
  expect((await Promise.all([recovery, normal])).map((response) => response.status)).toEqual([
    200, 200,
  ]);
  expect(
    fetch.mock.calls.filter(([url]) => String(url).endsWith('/tool_router/session')),
  ).toHaveLength(1);
});

test('each recovering request refuses a shared URL it has already seen rejected', async () => {
  const finalUrl = 'https://router.example/final';
  const firstFailure = deferred<Response>();
  const secondFailure = deferred<Response>();
  const firstStarted = deferred<void>();
  const secondStarted = deferred<void>();
  const mint = deferred<Response>();
  const mintStarted = deferred<void>();
  let mintCount = 0;
  let secondUrlCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === storedUrl) {
      firstStarted.resolve();
      return firstFailure.promise;
    }
    if (url === mintedUrl && secondUrlCalls++ === 0) {
      secondStarted.resolve();
      return secondFailure.promise;
    }
    if (url.endsWith('/tool_router/session')) {
      mintCount += 1;
      if (mintCount === 1) {
        mintStarted.resolve();
        return mint.promise;
      }
      return mintedResponse(finalUrl);
    }
    return new Response(url);
  });
  await storeUrl(storedUrl, new Date());
  const first = forward();
  await firstStarted.promise;
  await storeUrl(mintedUrl, new Date());
  const second = forward();
  await secondStarted.promise;
  firstFailure.resolve(new Response(null, { status: 401 }));
  await mintStarted.promise;
  secondFailure.resolve(new Response(null, { status: 403 }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  mint.resolve(mintedResponse(mintedUrl));
  const responses = await Promise.all([first, second]);
  expect(await responses[0]?.text()).toBe(mintedUrl);
  expect(await responses[1]?.text()).toBe(finalUrl);
  expect(mintCount).toBe(2);
});

test('a recovery mints again when a concurrent mint hands back the URL it saw rejected', async () => {
  await storeUrl(storedUrl, new Date());
  const staleResponse = deferred<Response>();
  const staleStarted = deferred<void>();
  const mint = deferred<Response>();
  const mintStarted = deferred<void>();
  let storedRequests = 0;
  let mintRequests = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input) === storedUrl && storedRequests++ === 0) {
      staleStarted.resolve();
      return staleResponse.promise;
    }
    if (String(input).endsWith('/tool_router/session')) {
      if (mintRequests++ > 0) return mintedResponse(mintedUrl);
      mintStarted.resolve();
      return mint.promise;
    }
    return new Response('ok');
  });
  const recovery = forward();
  await staleStarted.promise;
  await database.update(workspaceMember).set({ toolRouterUrl: null, toolRouterMintedAt: null });
  const normal = forward();
  await mintStarted.promise;
  staleResponse.resolve(new Response(null, { status: 401 }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  mint.resolve(mintedResponse(storedUrl));
  expect((await Promise.all([recovery, normal])).map((response) => response.status)).toEqual([
    200, 200,
  ]);
  expect(
    fetch.mock.calls.filter(([url]) => String(url).endsWith('/tool_router/session')),
  ).toHaveLength(2);
});
