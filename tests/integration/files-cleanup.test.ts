// Removing stored bytes: the trash purge, the daily storage sweep and its safety brake, and Anthropic upload cleanup.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

type Blob = { pathname: string; uploadedAt: Date };
const blob = vi.hoisted(() => ({
  remove: vi.fn(async (path: string | string[]) => {
    void path;
  }),
  list: vi.fn(async (options: { prefix: string }) => {
    void options;
    return { blobs: [] as Blob[], hasMore: false };
  }),
}));
vi.mock('@vercel/blob', () => ({ del: blob.remove, list: blob.list }));
vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});
const provider = vi.hoisted(() => ({
  uploads: [] as Array<{ id: string; filename: string; created_at: string; downloadable: boolean }>,
  resources: [] as Array<{ type: 'file'; file_id: string }>,
  deleted: [] as string[],
  failId: '',
  sessionsRead: [] as string[],
}));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      sessions: {
        resources: {
          list: async function* (id: string) {
            provider.sessionsRead.push(id);
            yield* provider.resources;
          },
        },
      },
      files: {
        list: async function* () {
          yield* provider.uploads;
        },
        delete: async (id: string) => {
          if (id === provider.failId) throw new Error('Provider refused deletion');
          provider.deleted.push(id);
        },
      },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});

import { db } from '@/db';
import { file, session, sessionFileMount, workspace } from '@/db/schema';
import { cleanupBlob } from '@/features/files/api/blob-storage';
import { reconcileAnthropicUploads } from '@/features/files/api/reconcile-anthropic-uploads';
import { deleteSessionFileMounts } from '@/features/files/api/session-file-mounts';
import { sweepStoredFiles } from '@/features/files/api/sweep-stored-files';
import { purgeTrashRows } from '@/features/files/api/trash-transitions';
import { purgeExpired } from '@/features/workspaces/api/purge-expired';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const testDb = makeTestDb(pool);
let workspaceId: string;
let sessionId: string;

beforeAll(async () => applyMigrations(testDb));
afterAll(async () => pool.end());
beforeEach(async () => {
  blob.remove.mockReset().mockResolvedValue(undefined);
  blob.list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
  Object.assign(provider, {
    uploads: [],
    resources: [],
    deleted: [],
    failId: '',
    sessionsRead: [],
  });
  await truncateAll(testDb);
  await seedUser(testDb, 'owner');
  await seedOrganization(testDb, 'org');
  workspaceId = requiredEntry(
    await db.insert(workspace).values({ organizationId: 'org', name: 'Org' }).returning(),
    0,
  ).id;
  sessionId = requiredEntry(
    await db
      .insert(session)
      .values({
        workspaceMemoryAccess: 'read_write',
        workspaceId,
        createdByUserId: 'owner',
        tier: 'default',
        kind: 'chat',
        anthropicSessionId: 'upstream',
      })
      .returning(),
    0,
  ).id;
});

function fileRow(storagePath: string, fields: Partial<typeof file.$inferInsert> = {}) {
  return {
    workspaceId,
    createdByUserId: 'owner',
    source: 'user_upload' as const,
    storagePath,
    filename: storagePath.split('/').at(-1) ?? 'file',
    mimeType: 'text/plain',
    sizeBytes: 1,
    ...fields,
  };
}

/** Storage lists these blobs under the workspace prefix and nothing elsewhere. */
function storageHolds(blobs: Blob[]) {
  blob.list.mockImplementation(async ({ prefix }) => ({
    blobs: prefix === 'ws/' ? blobs : [],
    hasMore: false,
  }));
}

const old = (pathname: string) => ({ pathname, uploadedAt: new Date(0) });
const expired = new Date(0);

describe('storage sweep', () => {
  test('deletes expired and orphaned bytes but keeps referenced and fresh uploads; dry run deletes nothing', async () => {
    const liveId = randomUUID();
    await db
      .insert(file)
      .values([
        fileRow('ws/live', { id: liveId }),
        fileRow('ws/expired', { thumbnailPath: 'ws/thumb', deletedAt: expired }),
      ]);
    storageHolds([
      old('ws/live'),
      old('ws/orphan'),
      old('ws/expired'),
      old('ws/thumb'),
      { pathname: 'ws/fresh', uploadedAt: new Date() },
      { pathname: 'ws/fresh2', uploadedAt: new Date() },
    ]);
    await sweepStoredFiles({ dryRun: true });
    expect(blob.remove).not.toHaveBeenCalled();
    await sweepStoredFiles({ dryRun: false });
    // The purge removes the expired file's own bytes by path before its row goes.
    expect(blob.remove.mock.calls[0]?.[0]).toEqual(['ws/expired', 'ws/thumb']);
    const removed = blob.remove.mock.calls.flatMap(([path]) => path);
    expect(removed).toContain('ws/orphan');
    expect(removed).not.toContain('ws/live');
    expect(removed.filter((path) => path.startsWith('ws/fresh'))).toEqual([]);
    expect((await db.select().from(file)).map((row) => row.id)).toEqual([liveId]);
  });

  test('a file whose path has spaces and non-ASCII letters is not mistaken for an orphan', async () => {
    const paths = ['ws/Chat uploads/Žinutė 日本語.txt', 'ws/Chat uploads/preview š.webp'] as const;
    await db.insert(file).values(fileRow(paths[0], { thumbnailPath: paths[1] }));
    storageHolds([...paths, 'ws/abandoned'].map(old));
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      removedBlobs: 1,
      aborted: false,
    });
    expect(blob.remove).toHaveBeenCalledWith(['ws/abandoned'], expect.anything());
  });

  test.each([
    ['outside any workspace', (index: number) => `ws/orphan-${index}`],
    ['under a live workspace', (index: number) => `ws/${workspaceId}/lost-${index}`],
  ])('many unexplained blobs %s stop the sweep before it deletes anything', async (_case, path) => {
    storageHolds(Array.from({ length: 150 }, (_, index) => old(path(index))));
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      aborted: true,
      removedBlobs: 0,
      explainedBlobs: 0,
    });
    expect(blob.remove).not.toHaveBeenCalled();
  });

  test('the bytes of a purged workspace are removed without tripping the brake', async () => {
    const purgedWorkspace = randomUUID();
    storageHolds(
      Array.from({ length: 150 }, (_, index) => old(`ws/${purgedWorkspace}/file-${index}`)),
    );
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      aborted: false,
      explainedBlobs: 150,
      removedBlobs: 150,
    });
  });

  test('a large trash purge removes its own bytes and never reaches the brake', async () => {
    const rows = Array.from({ length: 150 }, (_, index) =>
      fileRow(`ws/${workspaceId}/trashed-${index}`, { deletedAt: expired }),
    );
    await db.insert(file).values(rows);
    // Storage still lists the bytes the purge removed in this run.
    storageHolds(rows.map((row) => old(row.storagePath)));
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      aborted: false,
      expiredFiles: 150,
      explainedBlobs: 150,
    });
    expect(blob.remove.mock.calls[0]?.[0]).toHaveLength(150);
    expect(await db.select().from(file)).toEqual([]);
  });

  test('a failed batch delete reports every blob in it as failed', async () => {
    storageHolds([old('ws/orphan'), { pathname: 'ws/fresh', uploadedAt: new Date() }]);
    blob.remove.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      removedBlobs: 0,
      failed: [{ pathname: 'ws/orphan' }],
    });
  });

  test('an outage on a later prefix keeps the deletions and purged rows already done', async () => {
    await db.insert(file).values(fileRow('ws/expired', { deletedAt: expired }));
    blob.list.mockImplementation(async ({ prefix }) => {
      if (prefix === 'avatars/') throw new Error('storage unavailable');
      return { blobs: [old('ws/expired')], hasMore: false };
    });
    expect(await sweepStoredFiles({ dryRun: false })).toMatchObject({
      expiredFiles: 1,
      removedBlobs: 1,
      aborted: false,
      failed: [],
      sweepError: expect.any(String),
    });
    expect(blob.remove).toHaveBeenCalledWith(['ws/expired'], expect.anything());
  });

  test('a storage listing outage still reports every account purge result', async () => {
    blob.list.mockRejectedValueOnce(new Error('storage unavailable'));
    const report = await purgeExpired({ dryRun: true });
    expect(report.users.candidates).toBe(0);
    expect(report.workspaces.candidates).toBe(0);
    expect(report.memberlessOrgs.candidates).toBe(0);
    expect(report.storedFiles).toMatchObject({ aborted: false, failed: [] });
    expect(report.storedFiles.sweepError).toBeTruthy();
  });

  test('a failed cleanup of unclaimed bytes does not fail the caller', async () => {
    blob.remove.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(cleanupBlob('ws/unclaimed')).resolves.toBeUndefined();
  });
});

describe('trash purge', () => {
  test('a file whose bytes could not be removed keeps its row for the next purge', async () => {
    await db.insert(file).values(fileRow(`ws/${workspaceId}/kept`, { deletedAt: expired }));
    blob.remove.mockRejectedValueOnce(new Error('storage unavailable'));
    const report = await purgeTrashRows(new Date(), false);
    expect(report.removed).toEqual([]);
    expect(report.failed).toMatchObject([{ pathname: `ws/${workspaceId}/kept` }]);
    expect(await db.select().from(file)).toHaveLength(1);
  });

  test('an Anthropic refusal keeps that file and its upload for retry while the others go', async () => {
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await db.insert(file).values(fileRow(`ws/${workspaceId}/${id}`, { id, deletedAt: expired }));
      await db
        .insert(sessionFileMount)
        .values({ anthropicFileId: `file-${index}`, sessionId, workspaceId, fileId: id });
    }
    provider.failId = 'file-0';
    const report = await purgeTrashRows(new Date(), false);
    expect(report.failed).toHaveLength(1);
    expect(report.removed.map((row) => row.id)).toEqual([ids[1]]);
    expect((await db.select().from(file)).map((row) => row.id)).toEqual([ids[0]]);
    expect((await db.select().from(sessionFileMount)).map((row) => row.anthropicFileId)).toEqual([
      'file-0',
    ]);
    provider.failId = '';
    await purgeTrashRows(new Date(), false);
    expect(provider.deleted).toEqual(['file-1', 'file-0']);
    expect(await db.select().from(file)).toEqual([]);
    expect(await db.select().from(sessionFileMount)).toEqual([]);
  });

  test('an expired purge deadline stops before contacting Anthropic', async () => {
    await db
      .insert(sessionFileMount)
      .values({ anthropicFileId: 'budget', sessionId, workspaceId, fileId: null });
    await expect(
      deleteSessionFileMounts(eq(sessionFileMount.sessionId, sessionId), Date.now() - 1),
    ).rejects.toThrow();
    expect(provider.deleted).toEqual([]);
    expect((await testDb.execute(sql`select * from session_file_mount`)).rows).toHaveLength(1);
  });
});

describe('Anthropic upload reconciliation', () => {
  const reconcile = (dryRun: boolean, scope: 'inventory' | 'orphans' = 'inventory') =>
    reconcileAnthropicUploads({ dryRun, scope, deadline: Date.now() + 60_000 });
  const upload = (id: string, filename: string) => ({
    id,
    filename,
    created_at: new Date(0).toISOString(),
    downloadable: false,
  });

  test('a dry-run inventory changes nothing', async () => {
    provider.uploads = [upload('old', 'old.txt'), upload('unknown', 'other.txt')];
    provider.resources = [{ type: 'file', file_id: 'old' }];
    expect(await reconcile(true)).toMatchObject({
      retained: 1,
      unmatched: ['unknown'],
      deleted: 0,
    });
    expect(await db.select().from(sessionFileMount)).toEqual([]);
    expect(provider.deleted).toEqual([]);
  });

  test('an upload mounted before tracking existed is recorded once, so later purges remove it', async () => {
    provider.uploads = [upload('old', 'old.txt')];
    provider.resources = [{ type: 'file', file_id: 'old' }];
    expect(await reconcile(false)).toMatchObject({ retained: 1 });
    expect(await reconcile(false)).toMatchObject({ retained: 0 });
    expect(await db.select().from(sessionFileMount)).toEqual([
      expect.objectContaining({ anthropicFileId: 'old', sessionId, workspaceId }),
    ]);
  });

  test('an upload mounted in several sessions is never claimed by one of them', async () => {
    await db.insert(session).values({
      workspaceMemoryAccess: 'read_write',
      workspaceId,
      createdByUserId: 'owner',
      tier: 'default',
      kind: 'chat',
      anthropicSessionId: 'second-upstream',
    });
    provider.uploads = [upload('shared-provider-file', 'shared.txt')];
    provider.resources = [{ type: 'file', file_id: 'shared-provider-file' }];
    expect(await reconcile(false)).toMatchObject({
      matched: [],
      unmatched: ['shared-provider-file'],
      retained: 0,
      deleted: 0,
    });
    expect(await db.select().from(sessionFileMount)).toEqual([]);
  });

  test('the inventory deletes an unmounted upload a crash left, and only uploads the app owns', async () => {
    provider.uploads = [
      upload('crash', `agentcore_${sessionId}_none_output.txt`),
      upload('foreign', 'unowned.txt'),
    ];
    expect(await reconcile(false)).toMatchObject({ deleted: 1, unmatched: ['foreign'] });
    expect(provider.deleted).toEqual(['crash']);
  });

  test('recurring cleanup deletes only old unmounted app uploads and reads only their sessions', async () => {
    await db.insert(session).values({
      workspaceId,
      createdByUserId: 'owner',
      tier: 'default',
      kind: 'chat',
      workspaceMemoryAccess: 'none',
      anthropicSessionId: 'unrelated',
    });
    provider.uploads = [
      upload('orphan', `agentcore_${sessionId}_none_old.txt`),
      upload('foreign', 'foreign.txt'),
      {
        ...upload('new', 'agentcore_00000000-0000-0000-0000-000000000000_none_new.txt'),
        created_at: new Date().toISOString(),
      },
    ];
    expect(await reconcile(false, 'orphans')).toMatchObject({ deleted: 1 });
    expect(provider.sessionsRead).toEqual(['upstream']);
    expect(provider.deleted).toEqual(['orphan']);
  });

  test('a malformed app filename is left alone instead of breaking cleanup', async () => {
    provider.uploads = [upload('malformed', `agentcore_${'-'.repeat(36)}_none_old.txt`)];
    expect(await reconcile(false, 'orphans')).toMatchObject({
      unmatched: ['malformed'],
      deleted: 0,
    });
    expect(provider.sessionsRead).toEqual([]);
  });
});
