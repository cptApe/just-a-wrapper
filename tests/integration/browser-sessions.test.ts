// Browserbase resources on real Postgres and real billing: every browser used is billed once and
// released, and saved sign-ins (contexts) stay per member and are deleted with the workspace.
// Browserbase HTTP, Playwright and Anthropic are faked.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { fakeBrowserbase } from './helpers/fake-browserbase';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const transport = vi.hoisted(() => ({
  connectFails: false,
  closeFails: false,
  loadFails: false,
  landedUrl: 'https://example.org',
  reads: 0,
}));
vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: async () => {
      if (transport.connectFails) throw new Error('connect failed');
      return {
        contexts: () => [
          {
            pages: () => [
              {
                goto: async () => {
                  if (transport.loadFails) throw new Error('net::ERR_NAME_NOT_RESOLVED');
                },
                url: () => transport.landedUrl,
                title: async () => {
                  transport.reads += 1;
                  return 'Page';
                },
                evaluate: async () => {
                  transport.reads += 1;
                  return 'Useful page content. '.repeat(20);
                },
                screenshot: async () => {
                  throw new Error('screenshot unavailable');
                },
              },
            ],
          },
        ],
        close: async () => {
          if (transport.closeFails) throw new Error('close failed');
        },
      };
    },
  },
}));
vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    BROWSERBASE_API_KEY: 'test-browser-key',
    BROWSERBASE_PROJECT_ID: 'test-project',
  }),
);
vi.mock('@/features/agents', () => {
  const client = { beta: { sessions: { events: { send: async () => ({}) } } } };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});

const { browsePageTool } = await import('@/features/tools/custom-tools/browse-page');
const browserTimeout = await import('@/features/tools/api/browser-timeout');
const contexts = await import('@/features/tools/api/browser-contexts');
const { assertWorkspaceBrowserAvailable } = await import(
  '@/features/tools/api/browser-workspace-lock'
);
const { closeTaskBrowser } = await import('@/features/tools/api/browser-session');
const { finishDeletingWorkspaces } = await import('@/features/workspaces/api/purge-expired');
const { claimWorkspaceDeletion } = await import(
  '@/features/workspaces/api/workspace-lifecycle-transitions'
);
const { withRequestContext } = await import('@/lib/request-context');

const pool = makeTestPool();
const database = makeTestDb(pool);
const workspaceId = randomUUID();
const sessionRowId = randomUUID();
const otherSessionId = randomUUID();
let browserbase = fakeBrowserbase();

// The sweep runs inside the cron route's request context.
const sweep = () =>
  withRequestContext({ route: 'test' }, () => browserTimeout.reconcileTimedOutBrowserSessions());

beforeAll(async () => applyMigrations(database));
afterAll(async () => pool.end());
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  Object.assign(transport, {
    connectFails: false,
    closeFails: false,
    loadFails: false,
    landedUrl: 'https://example.org',
    reads: 0,
  });
  browserbase = fakeBrowserbase();
  vi.stubGlobal('fetch', browserbase.fetch);
  await truncateAll(database);
  await seedUser(database, 'owner');
  await seedOrganization(database, 'browser');
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, 'browser', 'Browser')`,
  );
  await database.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('browser', 'owner', 'owner')`,
  );
  await seedCreditBalance(database, workspaceId, 1000);
  for (const [id, upstream] of [
    [sessionRowId, 'upstream'],
    [otherSessionId, 'other-upstream'],
  ])
    await database.execute(sql`insert into session (workspace_memory_access, id, workspace_id, created_by_user_id, kind, tier, anthropic_session_id)
      values ('read_write', ${id}, ${workspaceId}, 'owner', 'chat', 'default', ${upstream})`);
});

async function charges() {
  return (
    await database.execute<{ usage_key: string; vendor_cost_cents: string }>(
      sql`select usage_key, vendor_cost_cents from usage_event where usage_key like 'tool:%' order by usage_key`,
    )
  ).rows.map((row) => ({ key: row.usage_key, cents: Number(row.vendor_cost_cents) }));
}

async function browserStatus(id = sessionRowId) {
  return (
    await database.execute(sql`select browserbase_session_status from session where id = ${id}`)
  ).rows;
}

describe('a page read', () => {
  const context = { sessionId: 'upstream', sessionRowId, workspaceId, userId: 'owner' };
  const read = () => browsePageTool.handler({ url: 'https://example.org' }, context);
  const minimumCharge = [{ key: 'tool:browser-session:browser_1', cents: 0.2 }];
  const candidateCount = async () =>
    (await database.execute(sql`select id from browser_candidate`)).rows.length;

  test('a short read bills the one-minute minimum and leaves nothing running', async () => {
    expect(await read()).toMatchObject({
      text: expect.stringContaining('Useful'),
      browserbaseSessionId: 'browser_1',
    });
    expect(browserbase.running()).toEqual([]);
    expect(await candidateCount()).toBe(0);
    expect(await charges()).toEqual(minimumCharge);
  });

  test.each([
    { case: 'the page fails to load', fail: 'loadFails' },
    { case: 'the browser cannot be reached', fail: 'connectFails' },
  ] as const)('when $case the browser it used is still billed and released', async ({ fail }) => {
    transport[fail] = true;
    await expect(read()).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
      cause: expect.any(Error),
    });
    expect(browserbase.running()).toEqual([]);
    expect(await charges()).toEqual(minimumCharge);
  });

  test('a redirect to a link-local address never yields its page text', async () => {
    transport.landedUrl = 'http://169.254.169.254/latest/meta-data';
    await expect(read()).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
      cause: expect.objectContaining({ code: 'TOOL_INPUT_INVALID' }),
    });
    expect(transport.reads).toBe(0);
    expect(await charges()).toEqual(minimumCharge);
  });

  test('a failed release still returns the page, and the sweep releases it later without a second charge', async () => {
    transport.closeFails = true;
    browserbase.failRelease(true);
    expect((await read()).text).toContain('Useful page content');
    expect(await charges()).toEqual(minimumCharge);
    expect(await candidateCount()).toBe(1);

    browserbase.failRelease(false);
    await database.execute(
      sql`update browser_candidate set created_at = now() - interval '11 minutes'`,
    );
    await sweep();
    expect(browserbase.running()).toEqual([]);
    expect(await candidateCount()).toBe(0);
    expect(await charges()).toEqual(minimumCharge);
  });
});

describe('long-held and busy browsers', () => {
  test("a person's control past the one-hour cap ends the browser and bills it once", async () => {
    const remote = browserbase.open({}, new Date(Date.now() - 2 * 3_600_000));
    await database.execute(
      sql`update session set browserbase_session_status = 'user', browserbase_session_id = ${remote.id}, browserbase_session_started_at = now() - interval '2 hours', browser_lease_expires_at = now() - interval '1 second' where id = ${sessionRowId}`,
    );
    await sweep();
    expect(await browserStatus()).toEqual([{ browserbase_session_status: 'ended' }]);
    expect(browserbase.running()).toEqual([]);
    const billed = await database.execute<{ event_type: string; credits_delta: number }>(
      sql`select event_type, credits_delta from usage_event where usage_key = ${`tool:browser-session:${remote.id}`}`,
    );
    expect(billed.rows).toHaveLength(1);
    expect(billed.rows[0]?.credits_delta).toBeLessThan(0);
  });

  test('closing is refused while a person controls, the agent acts, or a close is running', async () => {
    for (const status of ['user', 'acting', 'closing']) {
      await database.execute(
        sql`update session set browserbase_session_id = 'browser', browserbase_session_status = ${status}, browserbase_session_started_at = now(), browser_lease_expires_at = now() + interval '5 minutes' where id = ${sessionRowId}`,
      );
      await expect(closeTaskBrowser(sessionRowId)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await browserStatus()).toEqual([{ browserbase_session_status: status }]);
    }
  });

  test("an expired person's lease does not keep the workspace browser busy for another chat", async () => {
    const startedAt = new Date(Date.now() - 1000).toISOString();
    const endedAt = new Date().toISOString();
    await database.execute(
      sql`update session set browserbase_session_id = 'browser', browserbase_session_status = 'user', browserbase_session_started_at = ${startedAt}, browser_lease_expires_at = now() - interval '1 second' where id = ${sessionRowId}`,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 'browser', status: 'COMPLETED', startedAt, endedAt })),
    );
    await assertWorkspaceBrowserAvailable(workspaceId, otherSessionId, {
      kind: 'browserbase',
      apiKey: 'test-browser-key',
      projectId: 'test-project',
    });
    expect(await browserStatus()).toEqual([{ browserbase_session_status: 'ended' }]);
  });
});

describe('saved sign-ins', () => {
  test('each member gets their own saved sign-in, reused on later visits', async () => {
    await seedUser(database, 'other');
    await database.execute(
      sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('browser', 'other', 'other')`,
    );
    let created = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: `context-${++created}` })),
    );
    const own = await contexts.ensureMemberBrowserContext(workspaceId, 'owner');
    const other = await contexts.ensureMemberBrowserContext(workspaceId, 'other');
    expect(own).not.toBe(other);
    expect(await contexts.ensureMemberBrowserContext(workspaceId, 'owner')).toBe(own);
  });

  test('two concurrent first visits keep one sign-in and delete the loser, retrying until it goes', async () => {
    let created = 0;
    let allowCreate: (() => void) | undefined;
    const bothCreating = new Promise<void>((resolve) => {
      allowCreate = resolve;
    });
    let failDelete = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: RequestInit) => {
        if (options.method === 'POST') {
          const id = `context-${++created}`;
          if (created === 2) allowCreate?.();
          await bothCreating;
          return Response.json({ id });
        }
        return failDelete
          ? Response.json({ message: 'unavailable' }, { status: 503 })
          : new Response(null, { status: 204 });
      }),
    );
    const owners = await Promise.all([
      contexts.ensureMemberBrowserContext(workspaceId, 'owner'),
      contexts.ensureMemberBrowserContext(workspaceId, 'owner'),
    ]);
    expect(owners[0]).toBe(owners[1]);
    expect(await contexts.reconcileBrowserContextCandidates(workspaceId)).toBe(1);
    await database.execute(sql`delete from session where workspace_id = ${workspaceId}`);
    expect(await contexts.reconcileBrowserContextCandidates(workspaceId)).toBe(1);
    failDelete = false;
    expect(await contexts.reconcileBrowserContextCandidates(workspaceId)).toBe(0);
    const rows = await database.execute<{ browser_context_cleanup_ids: string[] }>(
      sql`select browser_context_cleanup_ids from workspace where id = ${workspaceId}`,
    );
    expect(rows.rows).toEqual([{ browser_context_cleanup_ids: [] }]);
  });

  test("deleting a workspace's sign-ins deletes each member's and clears the link", async () => {
    await database.execute(
      sql`update workspace_member set browserbase_context_id = 'member-context' where user_id = 'owner'`,
    );
    const deleted: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        deleted.push(url);
        return new Response(null, { status: 204 });
      }),
    );
    await contexts.deleteWorkspaceBrowserContexts(workspaceId);
    expect(deleted).toEqual(['https://api.browserbase.com/v1/contexts/member-context']);
    expect(
      (await database.execute(sql`select browserbase_context_id from workspace_member`)).rows,
    ).toEqual([{ browserbase_context_id: null }]);
  });

  test.each([
    'backlog',
    'workspaces',
  ] as const)('%s workspace deletion deletes saved sign-ins and a provider failure does not block it', async (kind) => {
    const otherWorkspaceId = randomUUID();
    await seedOrganization(database, 'other-context');
    await database.execute(
      sql`insert into workspace (id, organization_id, name, browser_context_cleanup_ids) values (${otherWorkspaceId}, 'other-context', 'Other', ARRAY['failed-context'])`,
    );
    await database.execute(
      sql`update workspace set browser_context_cleanup_ids = ARRAY['saved-context'] where id = ${workspaceId}`,
    );
    for (const id of [workspaceId, otherWorkspaceId])
      await database.transaction((tx) => claimWorkspaceDeletion(tx, id, new Date()));
    const deletedContexts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        expect(options.method).toBe('DELETE');
        deletedContexts.push(url);
        return url.endsWith('/failed-context')
          ? Response.json({ message: 'unavailable' }, { status: 503 })
          : new Response(null, { status: 204 });
      }),
    );
    const scope = kind === 'backlog' ? { kind } : { kind, ids: [workspaceId, otherWorkspaceId] };
    const report = await finishDeletingWorkspaces(Date.now() + 60_000, scope);
    expect(report).toMatchObject({ deleted: 2, failed: [] });
    expect(deletedContexts.sort()).toEqual([
      'https://api.browserbase.com/v1/contexts/failed-context',
      'https://api.browserbase.com/v1/contexts/saved-context',
    ]);
    expect(
      (
        await database.execute(
          sql`select lifecycle_status, browser_context_cleanup_ids from workspace order by organization_id`,
        )
      ).rows,
    ).toEqual([
      { lifecycle_status: 'deleted', browser_context_cleanup_ids: [] },
      { lifecycle_status: 'deleted', browser_context_cleanup_ids: ['failed-context'] },
    ]);
  });
});

// Runs last: it resets the module registry to load workspace deletion with Browserbase removed.
describe('with Browserbase credentials removed', () => {
  test('workspace deletion still succeeds and keeps the sign-in ids for a later cleanup', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', async (actual) =>
      (await import('./helpers/seams')).envWith(actual, {
        BROWSERBASE_API_KEY: undefined,
        BROWSERBASE_PROJECT_ID: undefined,
      }),
    );
    const purge = await import('@/features/workspaces/api/purge-expired');
    await database.execute(
      sql`update workspace set browser_context_cleanup_ids = ARRAY['context'] where id = ${workspaceId}`,
    );
    await database.transaction((tx) => claimWorkspaceDeletion(tx, workspaceId, new Date()));
    const report = await purge.finishDeletingWorkspaces(Date.now() + 60_000, { kind: 'backlog' });
    expect(report).toMatchObject({ deleted: 1, failed: [] });
    expect(browserbase.calls).toEqual([]);
    const rows = await database.execute(
      sql`select deleted_at, lifecycle_status, browser_context_cleanup_ids from workspace where id = ${workspaceId}`,
    );
    expect(rows.rows[0]).toMatchObject({
      lifecycle_status: 'deleted',
      browser_context_cleanup_ids: ['context'],
    });
    expect(rows.rows[0]?.deleted_at).not.toBeNull();
  });
});
