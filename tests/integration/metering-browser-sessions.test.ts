// Charging for Browserbase sessions, including ones a crashed or losing open leaves running.
// Only the Browserbase API, Stagehand and the Anthropic event transport are replaced.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { seedCreditBalance } from './helpers/billing-ledger';
import { fakeBrowserbase } from './helpers/fake-browserbase';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const provider = vi.hoisted(() => {
  process.env.BROWSERBASE_API_KEY = 'test-browser-key';
  process.env.BROWSERBASE_PROJECT_ID = 'test-project';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  return {
    browserbase: undefined as
      | ReturnType<typeof import('./helpers/fake-browserbase').fakeBrowserbase>
      | undefined,
    // 'hang-create': the process dies inside the create; 'hang-load': it dies loading the page.
    mode: 'ok' as 'ok' | 'hang-create' | 'hang-load',
    // Holds each create until this many have started, so two opens truly race to the claim.
    barrier: { size: 1, waiting: [] as Array<() => void> },
  };
});

vi.mock('@/features/agents', () => {
  const boundary = {
    getAnthropicClient: () => ({ beta: { sessions: { events: { send: async () => ({}) } } } }),
  };
  return { ...boundary, requireAnthropicClient: boundary.getAnthropicClient };
});
vi.mock('@browserbasehq/stagehand', () => ({
  Stagehand: class {
    browserbaseSessionID: string | undefined;
    private readonly options: {
      browserbaseSessionID?: string;
      browserbaseSessionCreateParams?: { userMetadata?: Record<string, string> };
    };
    constructor(options: FakeStagehandOptions) {
      this.options = options;
    }
    async init() {
      const fake = provider.browserbase;
      if (!fake) throw new Error('fake Browserbase missing');
      if (this.options.browserbaseSessionID) {
        this.browserbaseSessionID = this.options.browserbaseSessionID;
        return;
      }
      const created = fake.open(this.options.browserbaseSessionCreateParams?.userMetadata ?? {});
      const { barrier } = provider;
      await new Promise<void>((resolve) => {
        barrier.waiting.push(resolve);
        if (barrier.waiting.length >= barrier.size)
          for (const go of barrier.waiting.splice(0)) go();
      });
      if (provider.mode === 'hang-create') await new Promise(() => {});
      this.browserbaseSessionID = created.id;
    }
    context = {
      activePage: () => ({
        goto: async () => {
          if (provider.mode === 'hang-load') await new Promise(() => {});
        },
        evaluate: async () => ({ href: 'https://example.org/', title: 'Example', text: 'Example' }),
        title: async () => 'Example',
        url: () => 'https://example.org/',
      }),
    };
    async close() {}
  },
}));
type FakeStagehandOptions = {
  browserbaseSessionID?: string;
  browserbaseSessionCreateParams?: { userMetadata?: Record<string, string> };
};

const pool = makeTestPool();
const database = makeTestDb(pool);
const workspaceId = randomUUID();
const sessionRowId = randomUUID();
const { openTaskBrowser } = await import('@/features/tools/api/browser-session');
const { reconcileTimedOutBrowserSessions } = await import('@/features/tools/api/browser-timeout');

beforeAll(async () => applyMigrations(database));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(database);
  provider.mode = 'ok';
  provider.barrier = { size: 1, waiting: [] };
  provider.browserbase = fakeBrowserbase();
  vi.stubGlobal('fetch', provider.browserbase.fetch);
  await seedUser(database, 'owner');
  await seedOrganization(database, 'browser-candidates');
  await database.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('owner-member', 'browser-candidates', 'owner', 'owner', now())`,
  );
  await database.execute(
    sql`insert into workspace (id, organization_id, name) values (${workspaceId}, 'browser-candidates', 'Browser')`,
  );
  await database.execute(
    sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('browser-candidates', 'owner', 'owner-composio')`,
  );
  await seedCreditBalance(database, workspaceId, 100);
  await database.execute(sql`insert into session (workspace_memory_access, id, workspace_id, created_by_user_id, kind, tier, anthropic_session_id)
    values ('read_write', ${sessionRowId}, ${workspaceId}, 'owner', 'chat', 'default', 'upstream')`);
});

const open = () =>
  openTaskBrowser({ url: 'https://example.org/', workspaceId, userId: 'owner', sessionRowId });

function fake() {
  if (!provider.browserbase) throw new Error('fake Browserbase missing');
  return provider.browserbase;
}

async function candidates() {
  return (await database.execute(sql`select status, browserbase_session_id from browser_candidate`))
    .rows;
}

async function browserCharges() {
  return (
    await database.execute<{ usage_key: string; vendor_cost_cents: string }>(
      sql`select usage_key, vendor_cost_cents from usage_event where usage_key like 'tool:browser-session:%' order by usage_key`,
    )
  ).rows.map((row) => ({ key: row.usage_key, cents: Number(row.vendor_cost_cents) }));
}

// The process is gone once its lease has passed; the sweep may then act.
async function outliveLease() {
  await database.execute(
    sql`update browser_candidate set created_at = now() - interval '11 minutes'`,
  );
}

test('a browser left by a process killed mid-page-load is released and billed by the sweep, not leaked', async () => {
  provider.mode = 'hang-load';
  // The open never finishes: the process running it is gone.
  void open();
  await vi.waitFor(async () =>
    expect(await candidates()).toEqual([
      { status: 'created', browserbase_session_id: 'browser_1' },
    ]),
  );
  expect(fake().running()).toHaveLength(1);

  await reconcileTimedOutBrowserSessions();
  expect(fake().running()).toHaveLength(1);

  await outliveLease();
  await reconcileTimedOutBrowserSessions();

  expect(fake().running()).toEqual([]);
  expect(await candidates()).toEqual([]);
  expect(await browserCharges()).toEqual([{ key: 'tool:browser-session:browser_1', cents: 0.2 }]);
});

test('a browser left by a process killed mid-create is found by its tag, released and billed', async () => {
  provider.mode = 'hang-create';
  // The open never finishes: the process running it is gone.
  void open();
  await vi.waitFor(() => expect(fake().running()).toHaveLength(1));
  expect(await candidates()).toEqual([{ status: 'creating', browserbase_session_id: null }]);

  await outliveLease();
  await reconcileTimedOutBrowserSessions();

  expect(fake().running()).toEqual([]);
  expect(await candidates()).toEqual([]);
  expect(await browserCharges()).toEqual([{ key: 'tool:browser-session:browser_1', cents: 0.2 }]);
});

test('the sweep never releases or bills a browser a live session still owns', async () => {
  expect(await open()).toMatchObject({ browserbaseSessionId: 'browser_1', reused: false });
  expect(await candidates()).toEqual([]);

  await reconcileTimedOutBrowserSessions();

  expect(
    fake()
      .running()
      .map((session) => session.id),
  ).toEqual(['browser_1']);
  expect(await browserCharges()).toEqual([]);
});

test('the losing browser of two concurrent opens is released and billed the one-minute minimum', async () => {
  provider.barrier.size = 2;
  const [first, second] = await Promise.all([open(), open()]);

  expect(first.browserbaseSessionId).toBe(second.browserbaseSessionId);
  expect(fake().running()).toHaveLength(1);
  expect(await candidates()).toEqual([]);
  const loser = [...fake().sessions.keys()].find((id) => id !== first.browserbaseSessionId);
  expect(await browserCharges()).toEqual([{ key: `tool:browser-session:${loser}`, cents: 0.2 }]);
});

test('a losing browser whose release fails is billed once and released later by the sweep', async () => {
  fake().failRelease(true);
  provider.barrier.size = 2;
  const [first] = await Promise.all([open(), open()]);
  fake().failRelease(false);
  const loser = [...fake().sessions.keys()].find((id) => id !== first.browserbaseSessionId);
  expect(await candidates()).toEqual([{ status: 'created', browserbase_session_id: loser }]);
  expect(await browserCharges()).toEqual([{ key: `tool:browser-session:${loser}`, cents: 0.2 }]);

  await outliveLease();
  await reconcileTimedOutBrowserSessions();

  expect(
    fake()
      .running()
      .map((session) => session.id),
  ).toEqual([first.browserbaseSessionId]);
  expect(await candidates()).toEqual([]);
  expect(await browserCharges()).toEqual([{ key: `tool:browser-session:${loser}`, cents: 0.2 }]);
});
