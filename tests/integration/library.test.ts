// The Library's folders and files: who sees and may change what, subtree moves and deletes, trash and restore.
const state = vi.hoisted(() => ({ viewer: null as import('./helpers/seams').Viewer }));
// Callers resolve for real from the signed-in session and the seeded membership rows.
vi.mock('@/lib/auth', async () => (await import('./helpers/seams')).signedInAs(() => state.viewer));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
// The real handler signs a token; this stand-in runs the same pre-token hook it does.
vi.mock('@vercel/blob/client', () => ({
  handleUpload: async (input: {
    body: { payload: { pathname: string } };
    onBeforeGenerateToken: (pathname: string) => Promise<unknown>;
  }) => {
    await input.onBeforeGenerateToken(input.body.payload.pathname);
    return { type: 'blob.generate-client-token' };
  },
}));
vi.mock('@vercel/blob', () => ({
  head: async () => ({ uploadedAt: new Date(), size: 12, contentType: 'text/plain' }),
}));
vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});

import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { file, folder } from '@/db/schema';
import { newTaskWithFiles } from '@/features/chat/api/new-task-with-files';
import { createFolder, deleteFolder, renameFolder } from '@/features/files/api/folders';
import {
  deleteVisibleLibraryItem,
  ensureLibraryFolderPath,
  findVisibleLibraryFile,
  moveVisibleLibraryItem,
} from '@/features/files/api/library-operations';
import { loadFilesInFolder, loadFilesPage, loadFolders } from '@/features/files/api/load';
import { moveFiles, moveFolder } from '@/features/files/api/move';
import { resolveShare } from '@/features/files/api/resolve-share';
import { restoreFiles, restoreFolder } from '@/features/files/api/restore';
import { createShare } from '@/features/files/api/shares';
import { syncUploadedFile } from '@/features/files/api/sync-metadata';
import { authorizeUpload } from '@/features/files/api/upload-token';
import { uploadOwnerTag } from '@/features/files/lib/upload-policy';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const ORG = 'org_library';
const TEAMMATE_FOLDER_MESSAGE = 'This folder belongs to a teammate, so nothing can be added to it.';
const pool = makeTestPool();
const testDb = makeTestDb(pool);
let workspaceId: string;
type Actor = { workspaceId: string; userId: string };
let a: Actor;
let b: Actor;

beforeAll(async () => applyMigrations(testDb));
afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await truncateAll(testDb);
  await seedUser(testDb, 'user_a');
  await seedUser(testDb, 'user_b');
  await seedOrganization(testDb, ORG);
  workspaceId = requiredEntry(
    (
      await testDb.execute<{ id: string }>(
        sql`insert into workspace (organization_id, name) values (${ORG}, 'Library') returning id`,
      )
    ).rows,
    0,
  ).id;
  await testDb.execute(sql`insert into member (id, organization_id, user_id, role, created_at)
    values ('member_a', ${ORG}, 'user_a', 'owner', now()), ('member_b', ${ORG}, 'user_b', 'member', now())`);
  a = { workspaceId, userId: 'user_a' };
  b = { workspaceId, userId: 'user_b' };
  signIn(a);
});

function signIn(actor: Actor) {
  state.viewer = { userId: actor.userId, organizationId: ORG };
}

async function seedFolder(path: string, fields: Partial<typeof folder.$inferInsert> = {}) {
  return requiredEntry(
    await testDb
      .insert(folder)
      .values({ workspaceId, path, createdByUserId: a.userId, ...fields })
      .returning(),
    0,
  );
}

async function seedFile(
  folderPath: string,
  filename: string,
  fields: Partial<typeof file.$inferInsert> = {},
) {
  return requiredEntry(
    await testDb
      .insert(file)
      .values({
        workspaceId,
        createdByUserId: a.userId,
        source: 'user_upload',
        storagePath: `ws/${workspaceId}${folderPath === '/' ? '' : folderPath}/${filename}`,
        folderPath,
        filename,
        mimeType: 'text/plain',
        sizeBytes: 12,
        ...fields,
      })
      .returning(),
    0,
  );
}

async function fileState(name: string) {
  const row = (
    await testDb
      .select({ folderPath: file.folderPath, deletedAt: file.deletedAt })
      .from(file)
      .where(and(eq(file.workspaceId, workspaceId), eq(file.filename, name)))
  ).at(0);
  return row ? { folderPath: row.folderPath, deleted: row.deletedAt !== null } : null;
}

function libraryUpload(actor: Actor, folderPath: string, filename: string) {
  return syncUploadedFile({
    uploadSource: 'library',
    actor,
    folderPath,
    upload: {
      storagePath: `ws/${actor.workspaceId}${folderPath}/${uploadOwnerTag(actor.userId)}-${filename}`,
      originalFileName: filename,
    },
  });
}

function uploadToken(actor: Actor, folderPath: string) {
  return authorizeUpload(new Request('http://localhost/api/files/upload'), {
    type: 'blob.generate-client-token',
    payload: {
      pathname: `ws/${actor.workspaceId}${folderPath}/${uploadOwnerTag(actor.userId)}-b.txt`,
      clientPayload: null,
      multipart: false,
    },
  });
}

describe('what a member sees', () => {
  test('search and exact paths never show another member’s private file', async () => {
    await seedFile('/', 'mine.txt');
    await seedFile('/', 'secret.txt', { createdByUserId: b.userId });
    const search = await loadFilesPage(workspaceId, a.userId, {
      path: '/',
      type: null,
      q: '.txt',
      trash: false,
      sort: 'name',
      dir: 'asc',
      offset: 0,
    });
    expect(search.files.map((row) => row.filename)).toEqual(['mine.txt']);
    await expect(findVisibleLibraryFile(a, '/secret.txt')).resolves.toBeNull();
  });

  test('a folder lists only its own live files', async () => {
    for (const name of ['a.pdf', 'b.pdf']) await seedFile('/Docs', name);
    await seedFile('/Reports', 'r1.pdf');
    await seedFile('/Docs', 'trashed.pdf', { deletedAt: new Date() });
    const docs = await loadFilesInFolder(workspaceId, '/Docs', a.userId);
    expect(docs.map((entry) => entry.filename).sort()).toEqual(['a.pdf', 'b.pdf']);
  });

  test('both members upload to Chat uploads and each sees that one shared folder', async () => {
    await libraryUpload(a, '/Chat uploads', 'a.txt');
    await libraryUpload(b, '/Chat uploads', 'b.txt');
    const rows = await testDb.execute<{ created_by_user_id: string; filename: string }>(
      sql`select created_by_user_id, filename from file order by filename`,
    );
    expect(rows.rows).toEqual([
      { created_by_user_id: 'user_a', filename: 'a.txt' },
      { created_by_user_id: 'user_b', filename: 'b.txt' },
    ]);
    for (const actor of [a, b]) {
      await expect(loadFolders(workspaceId, actor.userId)).resolves.toEqual([
        expect.objectContaining({ path: '/Chat uploads' }),
      ]);
    }
  });

  test('a new task given a hidden folder answers as if the folder did not exist', async () => {
    await seedFolder('/Private reference', { createdByUserId: b.userId });
    const hidden = await newTaskWithFiles([], ['/Private reference'], ORG);
    const absent = await newTaskWithFiles([], ['/Absent reference'], ORG);
    expect(hidden).toEqual(absent);
    expect(hidden).toMatchObject({ ok: false, code: 'TOOL_INPUT_INVALID' });
  });
});

describe('a teammate’s private folder', () => {
  let noteId: string;
  beforeEach(async () => {
    await ensureLibraryFolderPath(a, '/Projects');
    await ensureLibraryFolderPath(b, '/Mine');
    noteId = (await seedFile('/', 'note.txt', { createdByUserId: b.userId })).id;
  });

  test.each([
    ['moving a file into it', () => moveFiles([noteId], '/Projects')],
    ['moving a folder into it', () => moveFolder('/Mine', '/Projects')],
    ['creating a subfolder in it', () => createFolder('/Projects', 'Sub')],
    ['the agent making a folder in it', () => ensureLibraryFolderPath(b, '/Projects/Child')],
    [
      'the agent moving a file into it',
      () => moveVisibleLibraryItem(b, '/note.txt', '/Projects/note.txt'),
    ],
    [
      'the agent moving a folder into it',
      () => moveVisibleLibraryItem(b, '/Mine', '/Projects/Mine'),
    ],
    ['an upload into it', () => libraryUpload(b, '/Projects/Sub', 'b.txt')],
    ['an upload token for it', () => uploadToken(b, '/Projects/Sub')],
  ])('%s is refused, even when the teammate has a file of their own inside', async (_case, run) => {
    // The caller's own file inside makes /Projects navigable without granting writes.
    await seedFile('/Projects', 'own.txt', { createdByUserId: b.userId });
    signIn(b);
    // Page actions return the refusal and library verbs throw it; both carry the same code.
    const [settled] = await Promise.allSettled([(run as () => Promise<unknown>)()]);
    const outcome = settled?.status === 'fulfilled' ? settled.value : settled?.reason;
    expect(outcome).toMatchObject({ code: 'TOOL_INPUT_INVALID', message: TEAMMATE_FOLDER_MESSAGE });
    expect(await fileState('note.txt')).toEqual({ folderPath: '/', deleted: false });
    const paths = (await testDb.select({ path: folder.path }).from(folder)).map((row) => row.path);
    expect(paths.sort()).toEqual(['/Mine', '/Projects']);
  });

  test('the teammate cannot rename or delete it, while a Team subfolder is shared', async () => {
    await seedFolder('/Team');
    await seedFolder('/Team/Reports');
    signIn(b);
    expect((await renameFolder('/Projects', 'Taken')).ok).toBe(false);
    expect((await deleteFolder('/Projects')).ok).toBe(false);
    expect((await renameFolder('/Team/Reports', 'Shared')).ok).toBe(true);
  });

  test('its owner still renames and deletes it, and the teammate still uploads to their own folder', async () => {
    await expect(moveVisibleLibraryItem(a, '/Projects', '/Renamed')).resolves.toEqual({
      kind: 'folder',
      path: '/Renamed',
    });
    await expect(deleteVisibleLibraryItem(a, '/Renamed')).resolves.toMatchObject({
      kind: 'folder',
      removed: 1,
    });
    signIn(b);
    await expect(uploadToken(b, '/Mine')).resolves.toMatchObject({
      type: 'blob.generate-client-token',
    });
  });

  test('agent output folders take files from every member, whoever made them first', async () => {
    await ensureLibraryFolderPath(b, '/Generated images');
    await expect(ensureLibraryFolderPath(a, '/Generated images')).resolves.toBe(
      '/Generated images',
    );
  });

  test('a shared folder holding a teammate’s private file cannot be moved or deleted', async () => {
    await ensureLibraryFolderPath(a, '/Chat uploads');
    await seedFile('/Chat uploads', 'a.txt');
    await seedFile('/Chat uploads', 'b.txt', { createdByUserId: b.userId });
    for (const run of [
      () => moveVisibleLibraryItem(b, '/Chat uploads', '/Archive/Chat uploads'),
      () => deleteVisibleLibraryItem(b, '/Chat uploads'),
    ]) {
      await expect(run()).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    }
    expect(await fileState('a.txt')).toEqual({ folderPath: '/Chat uploads', deleted: false });
  });
});

describe('subtree moves and deletes', () => {
  test('moving a folder moves every folder and file under it but keeps the stored bytes in place', async () => {
    await ensureLibraryFolderPath(a, '/Projects/Alpha/Nested');
    await seedFile('/Projects/Alpha', 'a.txt');
    await seedFile('/Projects/Alpha/Nested', 'b.txt');
    await expect(moveVisibleLibraryItem(a, '/Projects/Alpha', '/Archive/Renamed')).resolves.toEqual(
      { kind: 'folder', path: '/Archive/Renamed' },
    );
    const rows = await testDb.execute<{ folder_path: string; storage_path: string }>(
      sql`select folder_path, storage_path from file order by filename`,
    );
    expect(rows.rows.map((row) => row.folder_path)).toEqual([
      '/Archive/Renamed',
      '/Archive/Renamed/Nested',
    ]);
    expect(requiredEntry(rows.rows, 0).storage_path).toContain('/Projects/Alpha/a.txt');
  });

  test('deleting a folder trashes every folder and file under it', async () => {
    await ensureLibraryFolderPath(a, '/Projects/Alpha/Nested');
    await seedFile('/Projects/Alpha/Nested', 'b.txt');
    await expect(deleteVisibleLibraryItem(a, '/Projects')).resolves.toMatchObject({
      kind: 'folder',
      removed: 4,
    });
    const live = await testDb.execute<{ count: number }>(sql`
      select (select count(*) from folder where deleted_at is null)::int +
             (select count(*) from file where deleted_at is null)::int as count
    `);
    expect(requiredEntry(live.rows, 0).count).toBe(0);
  });

  test('moving a file onto another file’s name is refused', async () => {
    await seedFile('/', 'from.txt');
    await seedFile('/', 'to.txt');
    await expect(moveVisibleLibraryItem(a, '/from.txt', '/to.txt')).rejects.toMatchObject({
      code: 'TOOL_INPUT_INVALID',
    });
    expect(await fileState('from.txt')).toEqual({ folderPath: '/', deleted: false });
  });

  describe('a path with a LIKE wildcard', () => {
    // /a_b must never match /axb: `_` is a wildcard in SQL LIKE.
    beforeEach(async () => {
      await seedFolder('/a_b');
      await seedFolder('/axb');
      await seedFile('/a_b', 'target.txt');
      await seedFile('/axb', 'sibling.txt');
    });

    test.each([
      ['deleting', async () => deleteFolder('/a_b'), { folderPath: '/a_b', deleted: true }],
      ['renaming', async () => renameFolder('/a_b', 'a-b'), { folderPath: '/a-b', deleted: false }],
      [
        'moving',
        async () => {
          await seedFolder('/dest');
          return moveFolder('/a_b', '/dest');
        },
        { folderPath: '/dest/a_b', deleted: false },
      ],
    ])('%s /a_b leaves the /axb sibling alone', async (_case, run, target) => {
      expect((await run()).ok).toBe(true);
      expect(await fileState('target.txt')).toEqual(target);
      expect(await fileState('sibling.txt')).toEqual({ folderPath: '/axb', deleted: false });
    });

    test('restoring /a_b leaves a separately deleted /axb in the trash', async () => {
      await deleteFolder('/a_b');
      const earlier = new Date('2020-01-01T00:00:00Z');
      await testDb.update(file).set({ deletedAt: earlier }).where(eq(file.filename, 'sibling.txt'));
      await testDb.update(folder).set({ deletedAt: earlier }).where(eq(folder.path, '/axb'));
      const target = requiredEntry(
        await testDb.select().from(folder).where(eq(folder.path, '/a_b')),
        0,
      );
      expect((await restoreFolder(target.id)).ok).toBe(true);
      expect((await fileState('target.txt'))?.deleted).toBe(false);
      expect((await fileState('sibling.txt'))?.deleted).toBe(true);
    });
  });
});

describe('trash and folder identity', () => {
  test('restoring the older of two deleted folders with one path brings back only its files', async () => {
    const olderDeletion = new Date(Date.now() - 20000);
    const newerDeletion = new Date(Date.now() - 10000);
    const older = await seedFolder('/repeat', { deletedAt: olderDeletion });
    await seedFile('/repeat', 'older.txt', { deletedAt: olderDeletion });
    await seedFolder('/repeat', { deletedAt: newerDeletion });
    await seedFile('/repeat', 'newer.txt', { deletedAt: newerDeletion });
    expect((await restoreFolder(older.id)).ok).toBe(true);
    expect(await fileState('older.txt')).toMatchObject({ deleted: false });
    expect(await fileState('newer.txt')).toMatchObject({ deleted: true });
  });

  test('the trash lists both deleted folders that shared one path', async () => {
    const older = new Date(Date.now() - 20000);
    const newer = new Date(Date.now() - 10000);
    for (const path of ['/twice', '/twice/child']) {
      await seedFolder(path, { deletedAt: older });
      await seedFolder(path, { deletedAt: newer });
    }
    const page = await loadFilesPage(workspaceId, a.userId, {
      trash: true,
      path: '/',
      q: '',
      type: null,
      sort: 'name',
      dir: 'asc',
      offset: 0,
    });
    expect(page.deletedFolders?.map((entry) => entry.path)).toEqual(['/twice', '/twice']);
    expect(new Set(page.deletedFolders?.map((entry) => entry.id)).size).toBe(2);
  });

  test('files and folders past their trash period cannot be restored', async () => {
    const expired = await seedFolder('/expired', { deletedAt: new Date(0) });
    const expiredFile = await seedFile('/expired', 'expired.txt', { deletedAt: new Date(0) });
    expect((await restoreFolder(expired.id)).ok).toBe(false);
    expect(await restoreFiles([expiredFile.id])).toMatchObject({ ok: true, data: { restored: 0 } });
  });

  test.each([
    ['renaming', () => renameFolder('/repeat', 'renamed'), '/renamed'],
    ['moving', () => moveFolder('/repeat', '/destination'), '/destination/repeat'],
  ])('%s a folder moves its live identity and link, and leaves older trash where it was', async (_case, run, expectedPath) => {
    const old = new Date(Date.now() - 20000);
    const created = new Date(Date.now() - 10000);
    const recent = new Date(Date.now() - 5000);
    await seedFolder('/repeat', { deletedAt: old, createdAt: new Date(0) });
    const current = await seedFolder('/repeat', { createdAt: created });
    await seedFolder('/repeat/child', { createdAt: created, deletedAt: recent });
    await seedFolder('/destination');
    await seedFile('/repeat', 'old.txt', { deletedAt: old });
    await seedFile('/repeat/child', 'recent.txt', { deletedAt: recent });
    const shared = await createShare({
      target: { kind: 'folder', folderPath: '/repeat' },
      mode: 'view',
      expiresInDays: null,
    });
    if (!shared.ok) throw new Error(shared.message);
    expect((await run()).ok).toBe(true);
    expect(await resolveShare(shared.data.token)).toMatchObject({
      status: 'live',
      folderPath: expectedPath,
    });
    const moved = requiredEntry(
      await testDb.select().from(folder).where(eq(folder.id, current.id)),
      0,
    );
    expect(moved.path).toBe(expectedPath);
    expect(await fileState('old.txt')).toEqual({ folderPath: '/repeat', deleted: true });
    expect(await fileState('recent.txt')).toEqual({
      folderPath: `${expectedPath}/child`,
      deleted: true,
    });
  });
});
