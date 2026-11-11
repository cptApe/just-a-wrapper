// The retention purge cron: what it deletes, what it keeps for retry, and how one failing job leaves the others.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { purgeExpired } from '@/features/workspaces/api/purge-expired';
import { withRequestContext } from '@/lib/request-context';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.mock('@/lib/env', async (actual) =>
  (await import('./helpers/seams')).envWith(actual, {
    CRON_SECRET: 'isolated-purge-test',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_test_token',
  }),
);
const blobs = vi.hoisted(() => ({ removed: [] as string[], failListing: false }));
vi.mock('@vercel/blob', async (original) => ({
  ...(await original<typeof import('@vercel/blob')>()),
  del: async (pathname: string | string[]) => {
    blobs.removed.push(...(typeof pathname === 'string' ? [pathname] : pathname));
  },
  list: async () => {
    if (blobs.failListing) throw new Error('Storage unavailable');
    return { blobs: [], hasMore: false };
  },
}));
// Anthropic is off unless a test turns it on; its skill delete fails while `fail` is set.
const provider = vi.hoisted(() => ({ configured: false, deleted: [] as string[], fail: true }));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      sessions: { delete: async () => {} },
      files: {
        delete: async (id: string) => {
          provider.deleted.push(id);
        },
      },
      skills: {
        versions: {
          list: async function* () {
            yield { version: '1' };
          },
          delete: async () => {},
        },
        delete: async (id: string) => {
          if (provider.fail) throw new Error('Provider unavailable');
          provider.deleted.push(id);
        },
      },
    },
  };
  return {
    getAnthropicClient: () => (provider.configured ? client : null),
    requireAnthropicClient: () => {
      if (!provider.configured) throw new Error('Anthropic is unavailable');
      return client;
    },
  };
});
const { GET } = await import('@/app/api/cron/purge/route');
const pool = makeTestPool();
const database = makeTestDb(pool);
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  blobs.failListing = false;
  Object.assign(provider, { configured: false, deleted: [], fail: true });
  await truncateAll(database);
});
afterAll(() => pool.end());

function request(query: string) {
  return new Request(`http://localhost/api/cron/purge${query}`, {
    headers: { authorization: 'Bearer isolated-purge-test' },
  });
}
async function expiredIdentity() {
  await seedUser(database, 'purge-user');
  await seedOrganization(database, 'purge-org');
  await database.execute(
    sql`update "user" set account_status = 'deleted', deleted_at = now() - interval '31 days', deleted_email = email, email = 'deleted+' || id || '@deleted.agentcore.local' where id = 'purge-user'`,
  );
  await database.execute(
    sql`update organization set created_at = now() - interval '31 days' where id = 'purge-org'`,
  );
}

test('the nightly purge deletes identities and empty organizations past retention', async () => {
  await expiredIdentity();
  const response = await GET(request(''));
  expect(response.status).toBe(200);
  expect(
    (await database.execute(sql`select id from "user" where id = 'purge-user'`)).rows,
  ).toHaveLength(0);
  expect(
    (await database.execute(sql`select id from organization where id = 'purge-org'`)).rows,
  ).toHaveLength(0);
});

test('a dry run deletes nothing', async () => {
  await expiredIdentity();
  const response = await GET(request('?dryRun=true'));
  expect(response.status).toBe(200);
  expect(
    (await database.execute(sql`select id from "user" where id = 'purge-user'`)).rows,
  ).toHaveLength(1);
  expect(
    (await database.execute(sql`select id from organization where id = 'purge-org'`)).rows,
  ).toHaveLength(1);
});

test('a failing realtime cleanup does not hide that the workspace purge finished', async () => {
  await database.execute(sql`alter table realtime_event rename to realtime_event_unavailable`);
  try {
    const response = await GET(request('?dryRun=true'));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      realtime: { status: 'failed' },
      workspaces: { status: 'completed' },
      accessCleanup: { status: 'completed' },
    });
  } finally {
    await database.execute(sql`alter table realtime_event_unavailable rename to realtime_event`);
  }
});

test('old realtime events beyond one batch are all deleted', async () => {
  await seedOrganization(database, 'events-org');
  await database.execute(sql`insert into realtime_event (organization_id, type, payload, created_at)
    select 'events-org', 'test', '{}', now() - interval '2 days' from generate_series(1, 2100)`);
  const response = await GET(request(''));
  expect(response.status).toBe(200);
  expect((await database.execute(sql`select id from realtime_event`)).rows).toHaveLength(0);
});

test('cleanup that needs no Composio account finishes without one', async () => {
  await database.execute(
    sql`insert into integration_cleanup (composio_user_id, requires_composio) values ('no-provider', false)`,
  );
  const response = await GET(request(''));
  expect(response.status).toBe(200);
  expect((await database.execute(sql`select * from integration_cleanup`)).rows).toHaveLength(0);
});

test('cleanup that needs Composio stays queued while Composio is off', async () => {
  await database.execute(
    sql`insert into integration_cleanup (composio_user_id, requires_composio) values ('retained-provider', true)`,
  );
  const response = await GET(request(''));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({
    accessCleanup: { status: 'failed' },
  });
  expect(
    (
      await database.execute(
        sql`select composio_user_id, requires_composio, status, claimed_at from integration_cleanup`,
      )
    ).rows,
  ).toEqual([
    {
      composio_user_id: 'retained-provider',
      requires_composio: true,
      status: 'pending',
      claimed_at: null,
    },
  ]);
});

test('a failed workspace sweep still deletes expired accounts and reports failure', async () => {
  await expiredIdentity();
  await database.execute(sql`alter table workspace rename to workspace_unavailable`);
  try {
    const response = await GET(request(''));
    expect(response.status).toBe(500);
    const report = await response.json();
    expect(report.workspaces.report.workspaces.failed.length).toBeGreaterThan(0);
    expect(report.workspaces.report.users.deleted).toBe(1);
  } finally {
    await database.execute(sql`alter table workspace_unavailable rename to workspace`);
  }
});

test('many retained anonymous authors cannot stop a newly expired account being deleted', async () => {
  await seedOrganization(database, 'shared-org');
  await database.execute(
    sql`insert into workspace (organization_id, name) values ('shared-org', 'Shared')`,
  );
  await database.execute(sql`insert into "user" (id, name, email, email_verified, created_at, updated_at, account_status, deleted_at)
    select 'anon-' || n, 'Deleted account', 'deleted+anon-' || n || '@deleted.agentcore.local', true, now(), now(), 'anonymized', now() - interval '31 days' from generate_series(1, 50) n`);
  await database.execute(sql`insert into file (workspace_id, created_by_user_id, source, storage_path, filename, mime_type, size_bytes)
    select w.id, u.id, 'user_upload', u.id, 'file', 'text/plain', 1 from workspace w cross join "user" u where w.organization_id = 'shared-org'`);
  await expiredIdentity();
  await GET(request(''));
  expect(
    (await database.execute(sql`select id from "user" where id = 'purge-user'`)).rows,
  ).toHaveLength(0);
  expect(
    (await database.execute(sql`select id from "user" where account_status = 'anonymized'`)).rows,
  ).toHaveLength(50);
});

test('purging a workspace deletes the stored file bytes and thumbnails', async () => {
  blobs.removed = [];
  await seedUser(database, 'file-owner');
  await seedOrganization(database, 'file-org');
  await database.execute(
    sql`insert into workspace (organization_id, name, lifecycle_status, deleted_at) values ('file-org', 'Files', 'deleted', now() - interval '31 days')`,
  );
  await database.execute(sql`insert into file (workspace_id, created_by_user_id, source, storage_path, thumbnail_path, filename, mime_type, size_bytes)
    select id, 'file-owner', 'user_upload', 'original', 'thumbnail', 'file', 'image/png', 1 from workspace where organization_id = 'file-org'`);
  expect((await GET(request(''))).status).toBe(200);
  expect((await database.execute(sql`select id from file`)).rows).toHaveLength(0);
  expect(blobs.removed).toEqual(['original', 'thumbnail']);
});

test('workspaces that keep failing to purge cannot block the ones not yet tried', async () => {
  await database.execute(
    sql`insert into organization (id, name, slug, created_at) select 'failed-' || n, 'Failed', 'failed-' || n, now() from generate_series(1, 30) n`,
  );
  await database.execute(sql`insert into workspace (organization_id, name, lifecycle_status, deleted_at, workspace_memory_store_id)
    select id, name, 'deleted', now() - interval '31 days', 'unavailable-store' from organization`);
  expect((await GET(request(''))).status).toBe(500);
  expect((await GET(request(''))).status).toBe(500);
  expect(
    (await database.execute(sql`select id from workspace where purge_attempted_at is null`)).rows,
  ).toHaveLength(0);
});

test.each(['1', 'false'])('a malformed dryRun=%s is refused and deletes nothing', async (value) => {
  await expiredIdentity();
  const response = await GET(request(`?dryRun=${value}`));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'INVALID_BODY' } });
  expect(
    (await database.execute(sql`select id from "user" where id = 'purge-user'`)).rows,
  ).toHaveLength(1);
  expect(
    (await database.execute(sql`select id from organization where id = 'purge-org'`)).rows,
  ).toHaveLength(1);
});

test('while Anthropic is off a deleted workspace keeps its remote schedule ids for cleanup', async () => {
  const { finishDeletingWorkspaces } = await import('@/features/workspaces/api/purge-expired');
  await seedUser(database, 'task-owner');
  await seedOrganization(database, 'task-org');
  await database.execute(
    sql`insert into workspace (organization_id, name, lifecycle_status, deleted_at) values ('task-org', 'Tasks', 'deleting', now())`,
  );
  await database.execute(
    sql`insert into task (workspace_id, created_by_user_id, title, trigger_type, cron_schedule, anthropic_deployment_id) select id, 'task-owner', 'Retained schedule', 'schedule', '0 9 * * *', 'remote-deployment' from workspace`,
  );
  const report = await finishDeletingWorkspaces(Date.now() + 60_000, { kind: 'backlog' });
  expect(report.deleted).toBe(0);
  expect(report.failed).toHaveLength(1);
  expect((await database.execute(sql`select lifecycle_status from workspace`)).rows).toEqual([
    { lifecycle_status: 'deleting' },
  ]);
  expect((await database.execute(sql`select anthropic_deployment_id from task`)).rows).toEqual([
    { anthropic_deployment_id: 'remote-deployment' },
  ]);
});

test('a storage outage fails the workspace purge but not the other cleanup jobs', async () => {
  blobs.failListing = true;
  const response = await GET(request('?dryRun=true'));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({
    realtime: { status: 'completed' },
    workspaces: { status: 'failed', report: { storedFiles: { sweepError: expect.any(String) } } },
    accessCleanup: { status: 'completed' },
    disconnects: { status: 'completed' },
  });
});

test('a failed skill delete keeps the workspace and every retained skill id until a retry deletes them all', async () => {
  provider.configured = true;
  await seedOrganization(database, 'retention');
  await seedUser(database, 'owner');
  const workspaceId = requiredEntry(
    (
      await database.execute<{ id: string }>(
        sql`insert into workspace (organization_id, name, lifecycle_status, deleted_at) values ('retention', 'Retention', 'deleted', now() - interval '31 days') returning id`,
      )
    ).rows,
    0,
  ).id;
  await database.execute(
    sql`insert into skill (kind, owner_workspace_id, name, anthropic_skill_id, latest_version, retained_skill_ids) values ('custom', ${workspaceId}, 'Private playbook', 'skill_primary', '1', '["skill_retained"]'::jsonb)`,
  );
  const first = await withRequestContext({ route: 'test' }, () => purgeExpired({ dryRun: false }));
  expect(first.workspaces.failed).toHaveLength(1);
  expect((await database.execute(sql`select * from skill`)).rows).toHaveLength(1);
  expect((await database.execute(sql`select * from workspace`)).rows).toHaveLength(1);
  provider.fail = false;
  await database.execute(sql`update workspace set updated_at = now() - interval '1 hour'`);
  const second = await withRequestContext({ route: 'test' }, () => purgeExpired({ dryRun: false }));
  expect(second.workspaces.failed).toEqual([]);
  expect(provider.deleted.sort()).toEqual(['skill_primary', 'skill_retained']);
  expect((await database.execute(sql`select * from workspace`)).rows).toHaveLength(0);
});
