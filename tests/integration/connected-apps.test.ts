// Connected apps on real Postgres: connection and share state, credential cleanup and permission
// defaults. A stale worker never overwrites newer state; Composio is faked at fetch.
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db';
import {
  integration,
  integrationCleanup,
  member,
  sharedIntegration,
  workspace,
  workspaceMember,
} from '@/db/schema';
import { ensureConnectedAppToolDefaults } from '@/features/integrations/api/connection-tool-defaults';
import {
  beginConnectionDisconnect,
  finishConnectionDisconnect,
  recordConnectionState,
  recordConnectionStates,
} from '@/features/integrations/api/connection-transitions';
import {
  claimMemberCleanup,
  deleteMemberCleanup,
  enqueueMemberCleanup,
  releaseMemberCleanup,
} from '@/features/integrations/api/member-cleanup-transitions';
import {
  abandonPendingShare,
  attachPendingAccount,
  claimPendingShare,
} from '@/features/integrations/api/shared-connection-transitions';
import { startWorkspaceShare } from '@/features/integrations/api/shared-connections';
import {
  clearToolRouterCache,
  persistMintedUrl,
} from '@/features/integrations/api/tool-router-transitions';
import {
  attachClaimedVault,
  claimMemberVault,
  finishMemberVault,
} from '@/features/integrations/api/vault-transitions';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const database = makeTestDb(pool);
const key = { organizationId: 'integration-org', userId: 'integration-user' };
const composioUserId = 'integration-member';
let workspaceId: string;
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await database.delete(integrationCleanup);
  await seedUser(database, key.userId);
  await seedOrganization(database, key.organizationId);
  const inserted = (
    await database
      .insert(workspace)
      .values({ organizationId: key.organizationId, name: 'Integration workspace' })
      .returning()
  ).at(0);
  if (!inserted) throw new Error('Workspace fixture missing');
  workspaceId = inserted.id;
  await database
    .insert(member)
    .values({ id: 'integration-membership', ...key, role: 'owner', createdAt: new Date() });
  await database.insert(workspaceMember).values({ ...key, composioUserId });
});
afterAll(() => pool.end());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('a status read cannot reconnect an app mid-disconnect, and only the current disconnect can finish once', async () => {
  const connection = { workspaceId, userId: key.userId, toolkit: 'gmail' };
  expect(
    await recordConnectionState({ ...connection, connected: true, observedAt: new Date() }),
  ).toBe('connected');
  const claimedAt = await beginConnectionDisconnect(connection);
  if (claimedAt === null) throw new Error('Expected disconnect claim');
  expect(await beginConnectionDisconnect(connection)).toBeNull();
  expect(await finishConnectionDisconnect({ ...connection, claimedAt: new Date(0) })).toBe(false);
  expect(
    await recordConnectionState({ ...connection, connected: true, observedAt: new Date() }),
  ).toBe('unchanged');
  expect((await database.select().from(integration)).at(0)?.status).toBe('disconnecting');
  expect(await finishConnectionDisconnect({ ...connection, claimedAt })).toBe(true);
  expect(await finishConnectionDisconnect({ ...connection, claimedAt })).toBe(false);
});

test('a stale router URL cannot overwrite a newer one or come back for a removed member', async () => {
  const mint = {
    memberId: composioUserId,
    url: 'https://router.example/one',
    mintedAt: new Date(),
    generation: 0,
  };
  expect(await persistMintedUrl(mint)).toBe(true);
  expect(await persistMintedUrl({ ...mint, url: 'https://router.example/stale' })).toBe(false);
  await database.delete(workspaceMember).where(eq(workspaceMember.composioUserId, composioUserId));
  expect(await persistMintedUrl({ ...mint, generation: 1 })).toBe(false);
});

test('a router URL minted before a cache clear is not stored after it', async () => {
  const before = await database
    .select({
      generation: workspaceMember.toolRouterGeneration,
      url: workspaceMember.toolRouterUrl,
    })
    .from(workspaceMember)
    .where(eq(workspaceMember.composioUserId, composioUserId));
  expect(before.at(0)?.url).toBeNull();
  const generation = before.at(0)?.generation ?? -1;
  await clearToolRouterCache({ kind: 'member', memberId: composioUserId });
  expect(
    await persistMintedUrl({
      memberId: composioUserId,
      url: 'https://router.example/old-pins',
      mintedAt: new Date(),
      generation,
    }),
  ).toBe(false);
  const after = await database
    .select({ url: workspaceMember.toolRouterUrl })
    .from(workspaceMember)
    .where(eq(workspaceMember.composioUserId, composioUserId));
  expect(after.at(0)?.url).toBeNull();
});

test('a vault worker whose lease was taken over cannot attach or finish the vault', async () => {
  const old = new Date(Date.now() - 600_000);
  expect(await claimMemberVault(key, old)).not.toBeNull();
  const current = new Date();
  expect(await claimMemberVault(key, current)).not.toBeNull();
  expect(await attachClaimedVault({ ...key, claimedAt: old, vaultId: 'vault-old' })).toBe(false);
  expect(
    await finishMemberVault({
      ...key,
      claimedAt: old,
      status: 'unprovisioned',
      credentialKey: null,
      credentialUpdatedAt: null,
    }),
  ).toBe(false);
  expect(await attachClaimedVault({ ...key, claimedAt: current, vaultId: 'vault-current' })).toBe(
    true,
  );
  expect(
    await finishMemberVault({
      ...key,
      claimedAt: current,
      status: 'provisioned',
      credentialKey: null,
      credentialUpdatedAt: new Date(),
    }),
  ).toBe(true);
  expect(
    await finishMemberVault({
      ...key,
      claimedAt: current,
      status: 'unprovisioned',
      credentialKey: null,
      credentialUpdatedAt: null,
    }),
  ).toBe(false);
});

test('a second worker cannot claim a live vault lease, and a removed member gets no vault', async () => {
  const claimedAt = new Date();
  expect(await claimMemberVault(key, claimedAt)).not.toBeNull();
  expect(await claimMemberVault(key, new Date())).toBeNull();
  await database.delete(workspaceMember).where(eq(workspaceMember.composioUserId, composioUserId));
  expect(await attachClaimedVault({ ...key, claimedAt, vaultId: 'orphan' })).toBe(false);
});

test('credential cleanup outlives the member row, and finished cleanup never runs again', async () => {
  await db.transaction((tx) =>
    enqueueMemberCleanup(tx, { composioUserId, vaultId: 'vault', memoryStoreId: 'memory' }),
  );
  await database.delete(workspaceMember);
  const old = new Date(Date.now() - 600_000);
  expect(await claimMemberCleanup(composioUserId, old)).not.toBeNull();
  const claimedAt = new Date();
  expect(await claimMemberCleanup(composioUserId, claimedAt)).not.toBeNull();
  expect(await deleteMemberCleanup({ composioUserId, claimedAt: old })).toBe(false);
  expect(await deleteMemberCleanup({ composioUserId, claimedAt })).toBe(true);
  expect(await claimMemberCleanup(composioUserId, new Date())).toBeNull();
  expect(await releaseMemberCleanup({ composioUserId, claimedAt })).toBe(false);
});

test('a status read started before a disconnect cannot reconnect the app after it', async () => {
  const connection = { workspaceId, userId: key.userId, toolkit: 'gmail' };
  const observedAt = new Date(Date.now() - 10_000);
  await recordConnectionState({ ...connection, connected: true, observedAt });
  const claimedAt = await beginConnectionDisconnect(connection);
  if (claimedAt === null) throw new Error('Expected disconnect claim');
  await finishConnectionDisconnect({ ...connection, claimedAt });
  expect(await recordConnectionState({ ...connection, connected: true, observedAt })).toBe(
    'unchanged',
  );
  expect((await database.select().from(integration)).at(0)?.status).toBe('disconnected');
});

test('a provider answer cannot recreate a connection for a removed member', async () => {
  await database.delete(workspaceMember);
  expect(
    await recordConnectionState({
      workspaceId,
      userId: key.userId,
      toolkit: 'gmail',
      connected: true,
      observedAt: new Date(),
    }),
  ).toBe('unchanged');
  expect(await database.select().from(integration)).toHaveLength(0);
});

test('a status refresh of many apps changes only the apps whose state changed', async () => {
  const observedAt = new Date('2025-01-01');
  await recordConnectionStates({
    workspaceId,
    userId: key.userId,
    observedAt,
    connections: [
      { toolkit: 'gmail', connected: true },
      { toolkit: 'slack', connected: false },
    ],
  });
  const before = await database.select().from(integration);
  await recordConnectionStates({
    workspaceId,
    userId: key.userId,
    observedAt: new Date(),
    connections: [
      { toolkit: 'gmail', connected: true },
      { toolkit: 'slack', connected: true },
    ],
  });
  const after = await database.select().from(integration);
  expect(after.find((row) => row.toolkit === 'gmail')).toEqual(
    before.find((row) => row.toolkit === 'gmail'),
  );
  expect(after.find((row) => row.toolkit === 'slack')?.status).toBe('connected');
});

test('only the current cleanup worker can hand its job back for retry', async () => {
  await db.transaction((tx) =>
    enqueueMemberCleanup(tx, { composioUserId, vaultId: null, memoryStoreId: null }),
  );
  const stale = new Date(Date.now() - 600_000);
  expect(await claimMemberCleanup(composioUserId, stale)).not.toBeNull();
  const current = new Date();
  expect(await claimMemberCleanup(composioUserId, current)).not.toBeNull();
  expect(await releaseMemberCleanup({ composioUserId, claimedAt: stale })).toBe(false);
  expect(await releaseMemberCleanup({ composioUserId, claimedAt: current })).toBe(true);
  expect(await deleteMemberCleanup({ composioUserId, claimedAt: current })).toBe(false);
  expect(await claimMemberCleanup(composioUserId, new Date())).not.toBeNull();
});

const share = () => ({ workspaceId, toolkit: 'gmail', sharedByUserId: key.userId });

async function claim(): Promise<string> {
  const attempt = await claimPendingShare(share());
  if (attempt === null) throw new Error('Expected a share claim');
  return attempt;
}

test('an older workspace share attempt cannot attach its account over a newer one', async () => {
  const first = await claim();
  const second = await claim();
  expect(first).not.toBe(second);
  expect(
    await attachPendingAccount({ ...share(), attempt: second, connectedAccountId: 'ca_second' }),
  ).toBe(true);
  expect(
    await attachPendingAccount({ ...share(), attempt: first, connectedAccountId: 'ca_first' }),
  ).toBe(false);
  const rows = await database.select().from(sharedIntegration);
  expect(rows.map((row) => row.connectedAccountId)).toEqual(['ca_second']);
});

test('an older workspace share attempt cannot cancel a newer one', async () => {
  const first = await claim();
  const second = await claim();
  await abandonPendingShare({ ...share(), attempt: first });
  const rows = await database.select().from(sharedIntegration);
  expect(rows.map((row) => row.id)).toEqual([second]);
});

test('a share that already has an account cannot be taken over', async () => {
  const first = await claim();
  await attachPendingAccount({ ...share(), attempt: first, connectedAccountId: 'ca_first' });
  expect(await claimPendingShare(share())).toBeNull();
});

// Composio is faked at fetch; the account ids it hands out are recorded so none goes unowned.
function fakeComposio(onLink: () => Promise<void> = async () => {}) {
  const created: string[] = [];
  const deleted: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (init?.method === 'DELETE') {
      deleted.push(decodeURIComponent(url.split('/').at(-1) ?? ''));
      return Response.json({ success: true });
    }
    if (url.endsWith('/link')) {
      const id = `ca_${created.length + 1}`;
      created.push(id);
      await onLink();
      return Response.json({ redirect_url: `https://link/${id}`, connected_account_id: id });
    }
    return Response.json({ session_id: 'trs_1', mcp: { url: 'https://mcp' } });
  });
  return { created, deleted };
}

const startInput = () => ({ ...share(), organizationId: key.organizationId });

test('restarting a workspace share deletes the account the earlier attempt created', async () => {
  const composio = fakeComposio();
  await startWorkspaceShare(startInput(), 'key');
  await startWorkspaceShare(startInput(), 'key');
  const rows = await database.select().from(sharedIntegration);
  expect(rows.map((row) => row.connectedAccountId)).toEqual(['ca_2']);
  expect(composio.deleted).toEqual(['ca_1']);
});

test('a share attempt overtaken by a newer one deletes its own account', async () => {
  let raced = false;
  const composio = fakeComposio(async () => {
    if (raced) return;
    raced = true;
    await startWorkspaceShare(startInput(), 'key');
  });
  await expect(startWorkspaceShare(startInput(), 'key')).resolves.toEqual({
    status: 'already-shared',
  });
  const rows = await database.select().from(sharedIntegration);
  expect(rows.map((row) => row.connectedAccountId)).toEqual(['ca_2']);
  expect(composio.deleted).toEqual(['ca_1']);
});

// Composio's catalogue arrives in five pages of 50; even actions are reads, odd ones writes.
const catalogue = Array.from({ length: 232 }, (_, index) => {
  const suffix = String(index).padStart(3, '0');
  return index % 2 === 0
    ? {
        slug: `STRIPE_GET_FIXTURE_${suffix}`,
        name: 'Read',
        description: '',
        tags: ['readOnlyHint'],
      }
    : {
        slug: `STRIPE_CREATE_FIXTURE_${suffix}`,
        name: 'Create',
        description: '',
        tags: ['createHint'],
      };
});

test("connecting an app writes a default for every action, keeps the member's own choices, and repeats cleanly", async () => {
  const catalogFetch = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const offset = Number(url.searchParams.get('cursor') ?? '0');
    const items = catalogue.slice(offset, offset + 50);
    const nextOffset = offset + items.length;
    return Response.json({
      items,
      total_items: catalogue.length,
      next_cursor: nextOffset < catalogue.length ? String(nextOffset) : null,
    });
  });
  vi.stubGlobal('fetch', catalogFetch);
  const connect = () =>
    ensureConnectedAppToolDefaults({ ...key, toolkit: 'stripe', apiKey: 'fixture-key' });
  const rows = async () =>
    (
      await database.execute<{ tool_name: string; policy: string; updated_at: Date }>(
        sql`select tool_name, policy, updated_at from tool_permission where toolkit = 'stripe' order by tool_name`,
      )
    ).rows;

  await connect();
  const first = await rows();
  expect(first).toHaveLength(catalogue.length);
  expect(first.find((row) => row.tool_name === 'STRIPE_GET_FIXTURE_000')?.policy).toBe('allow');
  expect(first.find((row) => row.tool_name === 'STRIPE_CREATE_FIXTURE_001')?.policy).toBe('ask');
  expect(catalogFetch).toHaveBeenCalledTimes(5);

  await connect();
  expect(await rows()).toEqual(first);

  await database.execute(
    sql`update tool_permission set policy = 'block', updated_at = created_at + interval '1 second'
        where tool_name = 'STRIPE_CREATE_FIXTURE_001'`,
  );
  await connect();
  expect((await rows()).find((row) => row.tool_name === 'STRIPE_CREATE_FIXTURE_001')?.policy).toBe(
    'block',
  );
});
