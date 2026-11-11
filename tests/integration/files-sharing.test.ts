// Share links for folders and files: who may create, list and revoke them, and exactly what a link exposes while it lives.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});
vi.mock('@vercel/blob', () => ({
  del: async () => {},
  issueSignedToken: async () => ({}),
  presignUrl: async (_token: unknown, { pathname }: { pathname: string }) => ({
    presignedUrl: `https://blob.test/${pathname}`,
  }),
}));
// Server actions read the request cookie through next/headers; real auth resolves it.
const authState = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => authState.headers }));

import { db as appDb } from '@/db';
import { file, folder, folderShare, member, organization, workspace } from '@/db/schema';
import { readFileContent } from '@/features/files/api/file-content';
import { deleteFolder } from '@/features/files/api/folders';
import { loadLiveShare } from '@/features/files/api/live-share';
import { resolveShare } from '@/features/files/api/resolve-share';
import { revokeShares } from '@/features/files/api/share-transitions';
import { lockShareUploadFolder } from '@/features/files/api/share-upload-folder';
import { createShare, listShares, revokeShare } from '@/features/files/api/shares';
import { transitionFiles, transitionFolders } from '@/features/files/api/trash-transitions';
import { resolveUploadAccess } from '@/features/files/api/upload-access';
import { requireOwnedUpload } from '@/features/files/lib/upload-policy';
import { auth } from '@/lib/auth';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { type SignedIn, signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';
import { createTestWorkspace } from './helpers/workspace-actions';

const pool = makeTestPool();
const db = makeTestDb(pool);
let organizationId: string;
let workspaceId: string;
// The workspace owner and admin, the member who made the folders, and a teammate.
const people = {} as Record<'owner' | 'admin' | 'creator' | 'teammate', SignedIn>;
type Person = keyof typeof people;

beforeAll(async () => applyMigrations(db));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  people.owner = await signInWithEmailCode('share-owner@files.test');
  const org = await createTestWorkspace({
    body: { name: 'Share Auth Co', slug: `share-auth-${randomUUID()}` },
    headers: people.owner.headers,
  });
  organizationId = org.id;
  await auth.api.setActiveOrganization({ body: { organizationId }, headers: people.owner.headers });
  workspaceId = requiredEntry(
    (
      await db.execute<{ id: string }>(
        sql`select id from workspace where organization_id = ${organizationId} limit 1`,
      )
    ).rows,
    0,
  ).id;
  people.admin = await join('share-admin@files.test', 'admin');
  people.creator = await join('share-creator@files.test', 'member');
  people.teammate = await join('share-member@files.test', 'member');
  await db.insert(folder).values([
    { workspaceId, path: '/creator-folder', createdByUserId: people.creator.userId },
    { workspaceId, path: '/Team', createdByUserId: people.creator.userId },
    { workspaceId, path: '/Team/projects', createdByUserId: people.creator.userId },
    { workspaceId, path: '/owner-folder', createdByUserId: people.owner.userId },
  ]);
});

async function join(email: string, role: 'admin' | 'member') {
  const person = await signInWithEmailCode(email);
  await db.insert(member).values({
    id: randomUUID(),
    organizationId,
    userId: person.userId,
    role,
    createdAt: new Date(),
  });
  await auth.api.setActiveOrganization({ body: { organizationId }, headers: person.headers });
  return person;
}

function as(person: Person) {
  authState.headers = people[person].headers;
}

async function addFile(fields: Partial<typeof file.$inferInsert> = {}) {
  return requiredEntry(
    await db
      .insert(file)
      .values({
        workspaceId,
        createdByUserId: people.creator.userId,
        filename: 'proposal.txt',
        folderPath: '/creator-folder',
        source: 'user_upload',
        mimeType: 'text/plain',
        sizeBytes: 8,
        storagePath: `ws/${workspaceId}/${randomUUID()}`,
        ...fields,
      })
      .returning(),
    0,
  );
}

function fileTarget(row: typeof file.$inferSelect) {
  return { kind: 'file' as const, fileId: row.id, filename: row.filename };
}

async function folderLink(person: Person, folderPath: string, mode: 'view' | 'edit') {
  as(person);
  const created = await createShare({
    target: { kind: 'folder', folderPath },
    mode,
    expiresInDays: null,
  });
  if (!created.ok) throw new Error(created.message);
  return created.data;
}

async function fileLink(person: Person, row: typeof file.$inferSelect) {
  as(person);
  const created = await createShare({ target: fileTarget(row), mode: 'view', expiresInDays: null });
  if (!created.ok) throw new Error(created.message);
  return created.data;
}

/** A link row written directly, for states the actions never create. */
async function insertLink(fields: Partial<typeof folderShare.$inferInsert>) {
  const token = randomUUID();
  await db.insert(folderShare).values({
    workspaceId,
    folderId: null,
    mode: 'view',
    token,
    createdByUserId: people.creator.userId,
    ...fields,
  });
  return token;
}

function download(token: string, fileId: string, variant: 'content' | 'thumbnail' = 'content') {
  return readFileContent(new Request(`http://localhost/file?share=${token}`), fileId, variant);
}

describe('who may create and list folder links', () => {
  test.each([
    ['creator', '/creator-folder', 'edit', true],
    ['teammate', '/creator-folder', 'view', false],
    ['teammate', '/creator-folder', 'edit', false],
    ['teammate', '/owner-folder', 'view', false],
    ['admin', '/creator-folder', 'edit', false],
    ['creator', '/', 'edit', false],
    ['teammate', '/', 'view', false],
    ['admin', '/', 'edit', true],
    // The stored creator of the reserved Team folder gains nothing from it.
    ['creator', '/Team', 'edit', false],
    ['admin', '/Team', 'edit', true],
    ['creator', '/Team/projects', 'edit', true],
    ['teammate', '/Team/projects', 'edit', false],
  ] as const)('the %s creating a %s %s link is allowed: %s', async (person, folderPath, mode, allowed) => {
    as(person);
    const result = await createShare({
      target: { kind: 'folder', folderPath },
      mode,
      expiresInDays: null,
    });
    expect(result.ok).toBe(allowed);
  });

  test('a teammate cannot list the links of a folder they cannot share', async () => {
    as('teammate');
    for (const folderPath of ['/creator-folder', '/']) {
      expect((await listShares({ kind: 'folder', folderPath })).ok).toBe(false);
    }
  });

  test('having my own file inside a teammate’s private folder does not let me share it', async () => {
    await addFile({ createdByUserId: people.teammate.userId, filename: 'mine.txt' });
    await addFile({ createdByUserId: people.admin.userId, filename: 'admin.txt' });
    as('teammate');
    const view = await createShare({
      target: { kind: 'folder', folderPath: '/creator-folder' },
      mode: 'view',
      expiresInDays: null,
    });
    as('admin');
    const edit = await createShare({
      target: { kind: 'folder', folderPath: '/creator-folder' },
      mode: 'edit',
      expiresInDays: null,
    });
    expect([view.ok, edit.ok]).toEqual([false, false]);
  });

  test('a teammate listing Team links sees them without any link’s secret token', async () => {
    const creatorLink = await folderLink('creator', '/Team', 'view');
    const adminLink = await folderLink('admin', '/Team', 'edit');
    as('teammate');
    const listed = await listShares({ kind: 'folder', folderPath: '/Team' });
    if (!listed.ok) throw new Error(listed.message);
    expect(listed.data.map((entry) => entry.id).sort()).toEqual(
      [creatorLink.share.id, adminLink.share.id].sort(),
    );
    const body = JSON.stringify(listed);
    expect(body).not.toContain(creatorLink.token);
    expect(body).not.toContain(adminLink.token);
  });

  test('only the link’s creator can revoke it', async () => {
    const link = await folderLink('creator', '/Team/projects', 'view');
    as('teammate');
    expect((await revokeShare(link.share.id)).ok).toBe(false);
    expect(await resolveShare(link.token)).toMatchObject({ status: 'live' });
  });

  test('the database refuses two links with one token', async () => {
    const token = await insertLink({});
    await expect(insertLink({ token })).rejects.toThrow();
  });
});

describe('single file links', () => {
  test('a file link shows that one file, and the folder’s links stay separate', async () => {
    const row = await addFile();
    await addFile({ filename: 'private-notes.txt' });
    const link = await fileLink('creator', row);
    await folderLink('creator', row.folderPath, 'view');
    const resolved = await resolveShare(link.token);
    expect(resolved).toMatchObject({
      status: 'live',
      kind: 'file',
      mode: 'view',
      file: { id: row.id },
    });
    expect(resolved).not.toHaveProperty('files');
    const listed = await listShares(fileTarget(row));
    expect(listed.ok && listed.data.map((s) => s.id)).toEqual([link.share.id]);
    const folderLinks = await listShares({ kind: 'folder', folderPath: row.folderPath });
    expect(folderLinks.ok && folderLinks.data.map((s) => s.fileId)).toEqual([null]);
  });

  test('a teammate cannot create or list links for another person’s private file', async () => {
    const row = await addFile();
    as('teammate');
    expect(
      await createShare({ target: fileTarget(row), mode: 'view', expiresInDays: null }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await listShares(fileTarget(row))).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('a teammate may share a Team file', async () => {
    const row = await addFile({ folderPath: '/Team/projects' });
    as('teammate');
    expect(
      await createShare({ target: fileTarget(row), mode: 'view', expiresInDays: null }),
    ).toMatchObject({ ok: true });
  });

  test('a file can never get an edit link, from the action or straight in the database', async () => {
    const row = await addFile();
    as('creator');
    expect(
      await createShare({ target: fileTarget(row), mode: 'edit', expiresInDays: null }),
    ).toMatchObject({ ok: false, code: 'TOOL_INPUT_INVALID' });
    await expect(insertLink({ fileId: row.id, mode: 'edit' })).rejects.toThrow();
  });

  test('a file link follows the file through a rename and a move', async () => {
    const row = await addFile();
    const link = await fileLink('creator', row);
    await db
      .update(file)
      .set({ filename: 'revised.txt', folderPath: '/' })
      .where(eq(file.id, row.id));
    expect(await resolveShare(link.token)).toMatchObject({
      kind: 'file',
      file: { id: row.id, filename: 'revised.txt', folderPath: '/' },
    });
  });

  test('a trashed file cannot be shared, and its existing link shows nothing', async () => {
    const row = await addFile();
    const link = await fileLink('creator', row);
    await db.update(file).set({ deletedAt: new Date() }).where(eq(file.id, row.id));
    expect(await resolveShare(link.token)).toEqual({ status: 'not_found' });
    as('creator');
    expect(
      await createShare({ target: fileTarget(row), mode: 'view', expiresInDays: null }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  test('revoking a file link ends public access', async () => {
    const link = await fileLink('creator', await addFile());
    expect(await revokeShare(link.share.id)).toMatchObject({ ok: true });
    expect(await resolveShare(link.token)).toEqual({ status: 'revoked' });
  });

  test('deleting a file row deletes its links', async () => {
    const row = await addFile();
    const token = await insertLink({ fileId: row.id });
    await db.delete(file).where(eq(file.id, row.id));
    expect(await db.select().from(folderShare).where(eq(folderShare.token, token))).toEqual([]);
    expect(await resolveShare(token)).toEqual({ status: 'not_found' });
  });

  test('a file in another workspace cannot be shared or reached through this workspace’s link', async () => {
    const otherOrgId = randomUUID();
    await db
      .insert(organization)
      .values({ id: otherOrgId, name: 'Other workspace', slug: otherOrgId, createdAt: new Date() });
    const other = requiredEntry(
      await db.insert(workspace).values({ organizationId: otherOrgId, name: 'Other' }).returning(),
      0,
    );
    const row = await addFile({ workspaceId: other.id, folderPath: '/Team' });
    as('creator');
    expect(
      await createShare({ target: fileTarget(row), mode: 'view', expiresInDays: null }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await resolveShare(await insertLink({ fileId: row.id }))).toEqual({
      status: 'not_found',
    });
  });
});

describe('what a link exposes', () => {
  test.each([
    ['an expired folder link', { folderPath: '/creator-folder', expired: true }, 'expired'],
    ['a revoked folder link', { folderPath: '/creator-folder', revoked: true }, 'revoked'],
    ['an expired file link', { file: true, expired: true }, 'expired'],
  ] as const)('%s shows no files', async (_case, shape, status) => {
    const row = await addFile();
    const sharedFolder = requiredEntry(
      await db.select().from(folder).where(eq(folder.path, '/creator-folder')),
      0,
    );
    const token = await insertLink({
      folderId: 'folderPath' in shape ? sharedFolder.id : null,
      fileId: 'file' in shape ? row.id : null,
      expiresAt: 'expired' in shape ? new Date(Date.now() - 1000) : null,
      revokedAt: 'revoked' in shape ? new Date(Date.now() - 1000) : null,
    });
    expect(await resolveShare(token)).toEqual({ status });
    expect((await resolveShare(randomUUID())).status).toBe('not_found');
  });

  test('a folder or file link downloads exactly the files it lists, nothing below, private or trashed', async () => {
    const listedFile = await addFile({ filename: 'in-scope.txt' });
    const child = await addFile({ folderPath: '/creator-folder/child', filename: 'child.txt' });
    const teammateFile = await addFile({
      createdByUserId: people.teammate.userId,
      filename: 'teammate.txt',
    });
    const removed = await addFile({ filename: 'removed.txt', deletedAt: new Date() });
    const folderShareLink = await folderLink('creator', '/creator-folder', 'view');
    const fileShareLink = await fileLink('creator', listedFile);
    for (const token of [folderShareLink.token, fileShareLink.token]) {
      const resolved = await resolveShare(token);
      if (resolved.status !== 'live') throw new Error('share missing');
      const listed = resolved.kind === 'folder' ? resolved.files : [resolved.file];
      expect(listed.map((entry) => entry.id)).toEqual([listedFile.id]);
      expect((await download(token, listedFile.id)).status).toBe(307);
      for (const outside of [child, teammateFile, removed]) {
        await expect(download(token, outside.id)).rejects.toMatchObject({
          code: 'ARTIFACT_NOT_FOUND',
        });
      }
    }
  });

  test('a link to the workspace root shows only files that sit in the root', async () => {
    for (const folderPath of ['/creator-folder', '/Chat uploads'])
      await addFile({ folderPath, filename: folderPath });
    await addFile({ folderPath: '/', filename: 'creator-root' });
    await addFile({
      folderPath: '/',
      filename: 'owner-root',
      createdByUserId: people.owner.userId,
    });
    const link = await folderLink('owner', '/', 'view');
    const resolved = await resolveShare(link.token);
    if (resolved.status !== 'live' || resolved.kind !== 'folder') throw new Error('share missing');
    expect(resolved.files.map((entry) => entry.filename)).toEqual(['owner-root']);
  });

  test('a Chat uploads link shows only its creator’s uploads; an admin lists every such link', async () => {
    await db.insert(folder).values({
      workspaceId,
      createdByUserId: people.creator.userId,
      path: '/Chat uploads',
    });
    const owners = ['creator', 'teammate'] as const;
    const uploads = [];
    const links = [];
    for (const person of owners) {
      uploads.push(
        await addFile({
          folderPath: '/Chat uploads',
          filename: person,
          createdByUserId: people[person].userId,
        }),
      );
      links.push(await folderLink(person, '/Chat uploads', 'view'));
    }
    for (const [index, person] of owners.entries()) {
      const link = requiredEntry(links, index);
      const own = requiredEntry(uploads, index);
      const other = requiredEntry(uploads, 1 - index);
      const resolved = await resolveShare(link.token);
      if (resolved.status !== 'live' || resolved.kind !== 'folder')
        throw new Error('share missing');
      expect(resolved.files.map((entry) => entry.id)).toEqual([own.id]);
      expect((await download(link.token, own.id)).status).toBe(307);
      for (const variant of ['content', 'thumbnail'] as const) {
        await expect(download(link.token, other.id, variant)).rejects.toMatchObject({
          code: 'ARTIFACT_NOT_FOUND',
        });
      }
      as(person);
      const listed = await listShares({ kind: 'folder', folderPath: '/Chat uploads' });
      expect(listed.ok && listed.data.map((entry) => entry.id)).toEqual([link.share.id]);
    }
    as('admin');
    const listed = await listShares({ kind: 'folder', folderPath: '/Chat uploads' });
    expect(listed.ok && listed.data).toHaveLength(2);
  });

  test('an edit link reaches no subfolder, and deleting the folder revokes it for good', async () => {
    const link = await folderLink('creator', '/creator-folder', 'edit');
    const child = await addFile({
      folderPath: '/creator-folder/child',
      storagePath: `ws/${workspaceId}/private`,
    });
    await expect(download(link.token, child.id)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    });
    expect(() =>
      requireOwnedUpload(
        workspaceId,
        `share:${link.share.id}`,
        `ws/${workspaceId}/creator-folder/child/s-${link.share.id}-file`,
        '/creator-folder',
      ),
    ).toThrow();
    await expect(
      db.transaction((tx) => lockShareUploadFolder(tx, link.share.id, '/creator-folder/child')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    as('creator');
    expect((await deleteFolder('/creator-folder')).ok).toBe(true);
    expect(await resolveShare(link.token)).toEqual({ status: 'revoked' });
  });
});

describe('when a link stops working', () => {
  test('links stop resolving once their workspace is being deleted', async () => {
    const link = await folderLink('creator', '/creator-folder', 'view');
    await db
      .update(workspace)
      .set({ lifecycleStatus: 'deleting', deletedAt: new Date() })
      .where(eq(workspace.id, workspaceId));
    expect(await resolveShare(link.token)).toEqual({ status: 'revoked' });
  });

  test('demoting an admin revokes their root and Team edit links for visitors and in the share dialog', async () => {
    const rootFile = await addFile({
      createdByUserId: people.admin.userId,
      folderPath: '/',
      filename: 'root.txt',
    });
    const root = await folderLink('admin', '/', 'view');
    const teamEdit = await folderLink('admin', '/Team', 'edit');
    const teamView = await folderLink('admin', '/Team', 'view');
    await db.update(member).set({ role: 'member' }).where(eq(member.userId, people.admin.userId));
    expect(await resolveShare(root.token)).toEqual({ status: 'revoked' });
    expect(await resolveShare(teamEdit.token)).toEqual({ status: 'revoked' });
    expect(await resolveShare(teamView.token)).toMatchObject({ status: 'live', kind: 'folder' });
    await expect(resolveUploadAccess(teamEdit.token, new Headers())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(download(root.token, rootFile.id)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    });
    as('teammate');
    const listed = await listShares({ kind: 'folder', folderPath: '/Team' });
    if (!listed.ok) throw new Error(listed.message);
    const stateOf = (id: string) => listed.data.find((entry) => entry.id === id)?.state;
    expect([stateOf(teamEdit.share.id), stateOf(teamView.share.id)]).toEqual(['revoked', 'live']);
  });

  test('an upload already under way is refused once the link’s creator is demoted', async () => {
    const teamEdit = await folderLink('admin', '/Team', 'edit');
    await expect(
      db.transaction((tx) => lockShareUploadFolder(tx, teamEdit.share.id, '/Team')),
    ).resolves.toBeUndefined();
    await db.update(member).set({ role: 'member' }).where(eq(member.userId, people.admin.userId));
    await expect(
      db.transaction((tx) => lockShareUploadFolder(tx, teamEdit.share.id, '/Team')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a folder creator’s edit link keeps accepting uploads without an admin role', async () => {
    const link = await folderLink('creator', '/creator-folder', 'edit');
    expect(await resolveUploadAccess(link.token, new Headers())).toMatchObject({ kind: 'share' });
  });

  test('trashing a file revokes its link once, and restoring the file does not revive it', async () => {
    const row = await addFile();
    const link = await fileLink('creator', row);
    expect(await transitionFiles(appDb, eq(file.id, row.id), new Date())).toHaveLength(1);
    expect(await transitionFiles(appDb, eq(file.id, row.id), new Date())).toEqual([]);
    expect(await revokeShares(appDb, eq(folderShare.id, link.share.id))).toEqual([]);
    expect(await transitionFiles(appDb, eq(file.id, row.id), null)).toHaveLength(1);
    expect(await resolveShare(link.token)).not.toMatchObject({ status: 'live' });
  });

  test('a folder link follows its folder past a new folder at the old path, and stays revoked after restore', async () => {
    const id = randomUUID();
    await db
      .insert(folder)
      .values({ id, workspaceId, createdByUserId: people.creator.userId, path: '/old' });
    const token = await insertLink({ folderId: id, mode: 'edit' });
    await db.update(folder).set({ path: '/new' }).where(eq(folder.id, id));
    await db
      .insert(folder)
      .values({ workspaceId, createdByUserId: people.creator.userId, path: '/old' });
    expect((await loadLiveShare(token))?.folderPath).toBe('/new');
    await transitionFolders(appDb, eq(folder.id, id), new Date());
    expect(await loadLiveShare(token)).toBeNull();
    await transitionFolders(appDb, eq(folder.id, id), null);
    expect(await loadLiveShare(token)).toBeNull();
  });
});
