// The member's Anthropic vault on real Postgres: provisioning and repair of the MCP proxy credential,
// revocation cleanup, and the health check the Tools page shows. Anthropic and Composio are faked at
// fetch and the MCP transport at its SDK; the app's Anthropic client and proxy client run for real.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { db } from '@/db';
import { integrationCleanup, member, workspace, workspaceMember } from '@/db/schema';
import { getIntegrations, getMemberVaultHealth } from '@/features/integrations/api/connections';
import { drainMemberCleanups } from '@/features/integrations/api/member-cleanup';
import { enqueueMemberCleanup } from '@/features/integrations/api/member-cleanup-transitions';
import { ensureMemberVault } from '@/features/integrations/api/provision-vault';
import { checkMemberVaultHealth } from '@/features/integrations/api/vault-health';
import { verifyMemberToken } from '@/features/integrations/jwt';
import { vaultCredentialKey } from '@/features/integrations/lib/vault-credential-key';
import {
  completeProvisioning,
  invalidateProvisioning,
  provisionCapabilityKey,
} from '@/features/workspaces/api/provisioning-transitions';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const PROXY_URL = 'https://proxy.example.test/api/mcp/composio';
const JWT_SECRET = 'proxy-secret-with-more-than-32-characters';

const mcp = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  transports: [] as Array<{ url: string; authorization: string | undefined }>,
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = mcp.connect;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    close = mcp.close;
    constructor(url: URL, options: { requestInit: { headers: Record<string, string> } }) {
      mcp.transports.push({
        url: url.toString(),
        authorization: options.requestInit.headers.Authorization,
      });
    }
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth', async () =>
  (await import('./helpers/seams')).signedInAs(() => ({
    userId: 'user_1',
    organizationId: 'org_1',
  })),
);
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    COMPOSIO_API_KEY: 'test-composio-key',
    MCP_PROXY_URL: 'https://proxy.example.test/api/mcp/composio',
    MCP_PROXY_JWT_SECRET: 'proxy-secret-with-more-than-32-characters',
  }),
);
vi.mock('@/lib/observability', () => ({ captureException: vi.fn() }));
vi.mock('@/features/integrations/composio/connect', () => ({
  toolkitConnections: async (_url: string, _jwt: string, slugs: string[]) =>
    new Map(slugs.map((slug) => [slug, { status: 'active' }])),
  toolkitConnection: vi.fn(),
}));
vi.mock('@/features/integrations/composio/disconnect', () => ({
  disconnectToolkitAccounts: vi.fn(),
}));

const pool = makeTestPool();
const database = makeTestDb(pool);
const key = { organizationId: 'org_1', userId: 'user_1' };

type Credential = {
  id: string;
  display_name: string;
  archived_at: string | null;
  auth: { type: string; mcp_server_url: string };
};
const proxyCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'vcrd_existing',
  display_name: 'mcp-proxy',
  archived_at: null,
  auth: { type: 'static_bearer', mcp_server_url: PROXY_URL },
  ...overrides,
});

/** Anthropic vault requests the fake answered, newest last. */
let calls: Array<{ url: string; body: unknown }>;
let credentials: Credential[];
let failCredential: boolean;
let failCredentialList: boolean;
let recoveredVault: boolean;

beforeAll(() => applyMigrations(database));
afterAll(() => pool.end());
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await truncateAll(database);
  await seedOrganization(database, key.organizationId);
  await seedUser(database, key.userId);
  await database.insert(workspace).values({ organizationId: key.organizationId, name: 'Vault' });
  await database
    .insert(member)
    .values({ id: 'membership_1', ...key, role: 'owner', createdAt: new Date() });
  await database
    .insert(workspaceMember)
    .values({ ...key, composioUserId: 'member_1', mcpProxyVaultId: 'vlt_member' });
  calls = [];
  credentials = [];
  failCredential = false;
  failCredentialList = false;
  recoveredVault = false;
  mcp.transports = [];
  mcp.connect.mockReset().mockResolvedValue(undefined);
  mcp.close.mockReset().mockResolvedValue(undefined);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const method = (
      options?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    if (url.endsWith('/connected_accounts')) return Response.json({ items: [], next_cursor: null });
    calls.push({ url, body: typeof options?.body === 'string' ? JSON.parse(options.body) : null });
    if (url.endsWith('/v1/vaults/vlt_member') && method === 'GET')
      return Response.json({ id: 'vlt_member', archived_at: null });
    if (url.includes('/credentials') && method === 'GET')
      return failCredentialList
        ? Response.json({ error: { type: 'api_error', message: 'unavailable' } }, { status: 503 })
        : Response.json({ data: credentials, has_more: false });
    if (url.endsWith('/v1/vaults') && method === 'GET')
      return Response.json({
        data: recoveredVault
          ? [{ id: 'vlt_recovered', archived_at: null, metadata: { composio_user_id: 'member_1' } }]
          : [],
        has_more: false,
      });
    if (url.includes('/credentials') && failCredential)
      return Response.json(
        { error: { type: 'api_error', message: 'provider unavailable' } },
        { status: 503 },
      );
    if (url.endsWith('/v1/vaults') && method === 'POST')
      return Response.json({ id: 'vlt_created', archived_at: null });
    return Response.json({ id: 'vcrd_created' });
  });
});

async function memberRow() {
  return (await database.select().from(workspaceMember)).at(0);
}

describe('provisioning the proxy credential', () => {
  test('a credential pointing at an old proxy URL is replaced and the old one archived', async () => {
    credentials = [
      proxyCredential({
        id: 'vcrd_old',
        auth: { type: 'static_bearer', mcp_server_url: 'https://old.example/mcp' },
      }),
    ];
    expect(await ensureMemberVault({ ...key, refreshCredential: true })).toBe('vlt_member');
    expect(calls.some((call) => call.url.endsWith('/vcrd_old/archive'))).toBe(true);
    expect((await memberRow())?.vaultStatus).toBe('provisioned');
  });

  test('a credential for the current proxy URL is rotated in place, nothing archived', async () => {
    credentials = [proxyCredential()];
    expect(await ensureMemberVault({ ...key, refreshCredential: true })).toBe('vlt_member');
    expect(calls.some((call) => call.url.endsWith('/credentials/vcrd_existing'))).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/archive'))).toBe(false);
  });

  test('a failed credential write keeps the vault attached for a retry and releases the claim', async () => {
    failCredential = true;
    await expect(ensureMemberVault({ ...key, refreshCredential: true })).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
    });
    expect(await memberRow()).toMatchObject({
      vaultStatus: 'unprovisioned',
      mcpProxyVaultId: 'vlt_member',
      vaultClaimedAt: null,
    });
    failCredential = false;
    expect(await ensureMemberVault({ ...key, refreshCredential: true })).toBe('vlt_member');
  });

  test('a first vault is created from the stored claim without adopting a vault found by scanning', async () => {
    await database.update(workspaceMember).set({ mcpProxyVaultId: null });
    recoveredVault = true;
    expect(await ensureMemberVault({ ...key, refreshCredential: true })).toBe('vlt_created');
    const vaultCalls = calls.filter((call) => call.url.endsWith('/v1/vaults'));
    expect(vaultCalls.map((call) => call.body !== null)).toEqual([true]);
  });

  test.each([
    { case: 'its key is current', credentialKey: vaultCredentialKey(JWT_SECRET) },
    { case: 'its key is unknown', credentialKey: null },
  ])('a working vault stays usable while another request renews it and $case', async ({
    credentialKey,
  }) => {
    await database.update(workspaceMember).set({
      vaultStatus: 'provisioning',
      vaultCredentialKey: credentialKey,
      vaultClaimedAt: new Date(),
      vaultCredentialUpdatedAt: new Date(0),
    });
    expect(await ensureMemberVault({ ...key, refreshCredential: false })).toBe('vlt_member');
    expect(calls).toEqual([]);
  });

  test('a failed renewal keeps the working vault and its last renewal time', async () => {
    const updated = new Date('2020-01-01');
    await database.update(workspaceMember).set({
      vaultStatus: 'provisioned',
      vaultCredentialUpdatedAt: updated,
      vaultCredentialKey: vaultCredentialKey(JWT_SECRET),
    });
    failCredential = true;
    expect(await ensureMemberVault({ ...key, refreshCredential: false })).toBe('vlt_member');
    expect(await memberRow()).toMatchObject({
      vaultStatus: 'provisioned',
      vaultCredentialUpdatedAt: updated,
      vaultClaimedAt: null,
    });
  });

  test('a changed proxy signing key rotates the credential once', async () => {
    await ensureMemberVault({ ...key, refreshCredential: false });
    await database.update(workspaceMember).set({ vaultCredentialKey: 'previous-signing-key' });
    calls = [];
    await ensureMemberVault({ ...key, refreshCredential: false });
    expect(calls.some((call) => call.url.includes('/credentials'))).toBe(true);
    expect((await memberRow())?.vaultCredentialKey).toBe(vaultCredentialKey(JWT_SECRET));
    calls = [];
    await ensureMemberVault({ ...key, refreshCredential: false });
    expect(calls).toEqual([]);
  });

  test('a failed rotation after a key change never hands back a vault with a dead token', async () => {
    await ensureMemberVault({ ...key, refreshCredential: false });
    await database.update(workspaceMember).set({ vaultCredentialKey: 'previous-signing-key' });
    failCredential = true;
    await expect(ensureMemberVault({ ...key, refreshCredential: false })).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
    });
    expect((await memberRow())?.vaultCredentialKey).toBe('previous-signing-key');
  });

  test('workspace provisioning is invalidated by a stale credential key, once', async () => {
    const identity = {
      organizationId: key.organizationId,
      ownerUserId: key.userId,
      composioUserId: 'member_1',
    };
    await ensureMemberVault({ ...key, refreshCredential: false });
    expect(await completeProvisioning(identity)).toBe(true);
    expect(await invalidateProvisioning(identity)).toBe(false);
    await database.update(workspaceMember).set({ vaultCredentialKey: 'old-key' });
    expect(await invalidateProvisioning(identity)).toBe(true);
    expect(await invalidateProvisioning(identity)).toBe(false);
    expect(provisionCapabilityKey).not.toContain(vaultCredentialKey(JWT_SECRET));
  });
});

describe('revocation cleanup', () => {
  test('cleanup finds and archives a vault whose creation was never recorded', async () => {
    recoveredVault = true;
    await db.transaction((tx) =>
      enqueueMemberCleanup(tx, { composioUserId: 'member_1', vaultId: null, memoryStoreId: null }),
    );
    await database.delete(workspaceMember);
    expect(await drainMemberCleanups({ kind: 'backlog' })).toEqual({ completed: 1, failed: 0 });
    expect(calls.some((call) => call.url.endsWith('/vlt_recovered/archive'))).toBe(true);
    expect(await database.select().from(integrationCleanup)).toHaveLength(0);
  });

  test('cleanup archives the known vault before scanning for orphaned ones', async () => {
    await db.transaction((tx) =>
      enqueueMemberCleanup(tx, {
        composioUserId: 'member_1',
        vaultId: 'vlt_member',
        memoryStoreId: null,
      }),
    );
    await drainMemberCleanups({ kind: 'backlog' });
    const archiveIndex = calls.findIndex((call) => call.url.endsWith('/vlt_member/archive'));
    const discoveryIndex = calls.findIndex((call) => call.url.endsWith('/v1/vaults'));
    expect(archiveIndex).toBeGreaterThanOrEqual(0);
    expect(discoveryIndex).toBeGreaterThan(archiveIndex);
  });
});

describe('vault health', () => {
  beforeEach(async () => {
    await database
      .update(workspaceMember)
      .set({ vaultCredentialKey: vaultCredentialKey(JWT_SECRET) });
    credentials = [proxyCredential()];
  });

  test.each([
    null,
    'previous-signing-key',
  ])('a stored credential key that is missing or stale (%s) is broken, without asking Anthropic', async (credentialKey) => {
    await database.update(workspaceMember).set({ vaultCredentialKey: credentialKey });
    await expect(checkMemberVaultHealth(key)).resolves.toEqual({
      status: 'broken',
      reason: 'credential-missing',
    });
    expect(calls).toEqual([]);
    expect(mcp.connect).not.toHaveBeenCalled();
  });

  test.each([
    { case: 'there is no proxy credential', list: [] },
    {
      case: 'the only one is archived',
      list: [proxyCredential({ archived_at: '2026-08-18T00:00:00Z' })],
    },
    {
      case: 'it targets an old proxy URL',
      list: [
        proxyCredential({
          auth: { type: 'static_bearer', mcp_server_url: 'https://old-proxy.example.test/mcp' },
        }),
      ],
    },
  ])('the vault is broken when $case', async ({ list }) => {
    credentials = list;
    await expect(checkMemberVaultHealth(key)).resolves.toEqual({
      status: 'broken',
      reason: 'credential-missing',
    });
    expect(mcp.connect).not.toHaveBeenCalled();
  });

  test('a healthy vault is probed through the proxy with a fresh token for this member', async () => {
    await expect(checkMemberVaultHealth(key)).resolves.toEqual({ status: 'healthy' });
    expect(mcp.transports).toEqual([{ url: PROXY_URL, authorization: expect.any(String) }]);
    const token = mcp.transports[0]?.authorization?.replace('Bearer ', '') ?? '';
    await expect(verifyMemberToken(token, JWT_SECRET)).resolves.toBe('member_1');
  });

  test('a proxy outage is unknown, not broken, so the member is not told to reconnect', async () => {
    mcp.connect.mockRejectedValue(new Error('connection refused'));
    await expect(checkMemberVaultHealth(key)).resolves.toEqual({
      status: 'unknown',
      reason: 'proxy-unreachable',
    });
  });

  test('a slow proxy cold start is waited for, and a proxy that never answers is closed after 15 seconds', async () => {
    // Fake time keeps flowing so the real database round trips still complete.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mcp.connect.mockReturnValue(new Promise(() => undefined));
      let settled = false;
      const pending = checkMemberVaultHealth(key).finally(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(mcp.connect).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({ status: 'unknown', reason: 'proxy-unreachable' });
      expect(mcp.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  test("the check reads only the caller's own membership in the requested workspace", async () => {
    // The same user in another workspace, and another user in this one, both have healthy vaults.
    await seedOrganization(database, 'org_2');
    await seedUser(database, 'user_2');
    await database.update(workspaceMember).set({ mcpProxyVaultId: null });
    for (const [organizationId, userId, composioUserId] of [
      ['org_2', 'user_1', 'member_2'],
      ['org_1', 'user_2', 'member_3'],
    ] as const)
      await database.insert(workspaceMember).values({
        organizationId,
        userId,
        composioUserId,
        mcpProxyVaultId: `vlt_${composioUserId}`,
        vaultCredentialKey: vaultCredentialKey(JWT_SECRET),
      });

    await expect(checkMemberVaultHealth(key)).resolves.toEqual({ status: 'unprovisioned' });
    expect(calls).toEqual([]);
  });

  test('the Tools page lists connections without waiting on a vault health check', async () => {
    const result = await getIntegrations();
    if (result.status !== 'ok') throw new Error('Expected integrations data');
    expect(result.integrations[0]).toMatchObject({ connected: true });
    expect(calls).toEqual([]);
    expect(mcp.connect).not.toHaveBeenCalled();
  });

  test('a failed vault lookup shows as an inconclusive check, not a broken connection', async () => {
    failCredentialList = true;
    await expect(getMemberVaultHealth()).resolves.toEqual({
      status: 'unknown',
      reason: 'check-failed',
    });
  });
});

// Runs last: it resets the module registry to load the check with connected apps turned off.
describe('vault health with connected apps off', () => {
  test('a deployment without a Composio key reports unprovisioned instead of probing', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', async (actual) =>
      (await import('./helpers/seams')).envWith(actual, { COMPOSIO_API_KEY: undefined }),
    );
    const { checkMemberVaultHealth: checkWithAppsOff } = await import(
      '@/features/integrations/api/vault-health'
    );

    await expect(checkWithAppsOff(key)).resolves.toEqual({ status: 'unprovisioned' });
    expect(calls).toEqual([]);
    expect(mcp.connect).not.toHaveBeenCalled();
  });
});
