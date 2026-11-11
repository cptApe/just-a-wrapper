// Who may read or change a stored file by its id: file bytes, thumbnails, profile images, upload tokens, rename and delete.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});
const blobState = vi.hoisted(() => ({
  remove: vi.fn(async (pathname: string) => {
    void pathname;
  }),
}));
vi.mock('@vercel/blob', () => ({
  del: blobState.remove,
  issueSignedToken: async () => ({}),
  presignUrl: async (_token: unknown, { pathname }: { pathname: string }) => ({
    presignedUrl: `https://blob.test/${pathname}`,
  }),
}));
// Server actions read the request cookie through next/headers; real auth resolves it.
const authState = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => authState.headers }));

import { POST as uploadTokenRoute } from '@/app/api/files/upload-token/route';
import { file, folder, folderShare, member, organization, user } from '@/db/schema';
import { deleteFiles } from '@/features/files/api/delete-files';
import { readFileContent } from '@/features/files/api/file-content';
import { processProfileImage, readProfileImage } from '@/features/files/api/profile-images';
import { renameFile } from '@/features/files/api/rename-file';
import { restoreFiles } from '@/features/files/api/restore';
import { auth } from '@/lib/auth';
import { withRequestContext } from '@/lib/request-context';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, truncateAll } from './helpers/schema-setup';
import { type SignedIn, signInWithEmailCode } from './helpers/sign-in';
import { makeTestDb, makeTestPool } from './helpers/test-db';
import { createTestWorkspace } from './helpers/workspace-actions';

const pool = makeTestPool();
const db = makeTestDb(pool);
let organizationId: string;
let workspaceId: string;
// The workspace admin, the member who uploads the files, and a teammate.
let admin: SignedIn;
let creator: SignedIn;
let teammate: SignedIn;

beforeAll(async () => applyMigrations(db));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  blobState.remove.mockReset().mockResolvedValue(undefined);
  const owner = await signInWithEmailCode('access-owner@files.test');
  const org = await createTestWorkspace({
    body: { name: 'Access Co', slug: `access-${randomUUID()}` },
    headers: owner.headers,
  });
  organizationId = org.id;
  workspaceId = requiredEntry(
    (
      await db.execute<{ id: string }>(
        sql`select id from workspace where organization_id = ${organizationId} limit 1`,
      )
    ).rows,
    0,
  ).id;
  admin = await join('access-admin@files.test', 'admin');
  creator = await join('access-creator@files.test', 'member');
  teammate = await join('access-member@files.test', 'member');
  await db.insert(folder).values(
    ['/creator-folder', '/Team'].map((path) => ({
      workspaceId,
      path,
      createdByUserId: creator.userId,
    })),
  );
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

/** A person signed in to a workspace of their own, outside this one. */
async function outsider(email: string) {
  const person = await signInWithEmailCode(email);
  const other = await createTestWorkspace({
    body: { name: 'Other', slug: `other-${randomUUID()}` },
    headers: person.headers,
  });
  await auth.api.setActiveOrganization({
    body: { organizationId: other.id },
    headers: person.headers,
  });
  return person;
}

async function storedFile(folderPath: string) {
  return requiredEntry(
    await db
      .insert(file)
      .values({
        workspaceId,
        createdByUserId: creator.userId,
        filename: 'private.txt',
        folderPath,
        thumbnailPath: `ws/${workspaceId}/.thumbs/${randomUUID()}.webp`,
        source: 'user_upload',
        mimeType: 'text/plain',
        sizeBytes: 8,
        storagePath: `ws/${workspaceId}/${randomUUID()}`,
      })
      .returning(),
    0,
  );
}

function read(
  row: typeof file.$inferSelect,
  variant: 'content' | 'thumbnail',
  headers: Headers,
  token: string | null,
) {
  return withRequestContext({ route: 'test/files/access' }, () =>
    readFileContent(
      new Request(
        `http://localhost/api/files/${row.id}/${variant}${token ? `?share=${token}` : ''}`,
        { headers },
      ),
      row.id,
      variant,
    ),
  );
}

async function viewLink(fields: { fileId?: string; folderPath?: string }) {
  const token = randomUUID();
  await db.insert(folderShare).values({
    workspaceId,
    fileId: fields.fileId ?? null,
    folderId: fields.folderPath
      ? sql`(select id from folder where workspace_id = ${workspaceId} and path = ${fields.folderPath} and deleted_at is null limit 1)`
      : null,
    mode: 'view',
    token,
    createdByUserId: creator.userId,
  });
  return token;
}

test.each([
  'a member of another workspace',
  'a teammate, for a private file',
  'a link to another file',
] as const)('file bytes and thumbnail are not found for %s', async (reader) => {
  const row = await storedFile(
    reader === 'a member of another workspace' ? '/Team' : '/creator-folder',
  );
  let headers = new Headers();
  let token: string | null = null;
  if (reader === 'a member of another workspace')
    headers = (await outsider('outsider@files.test')).headers;
  if (reader === 'a teammate, for a private file') headers = teammate.headers;
  if (reader === 'a link to another file') {
    token = await viewLink({ fileId: (await storedFile('/creator-folder')).id });
  }
  for (const variant of ['content', 'thumbnail'] as const) {
    await expect(read(row, variant, headers, token)).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    });
  }
});

test.each([
  'its creator',
  'a teammate, for a Team file',
  'a link to the file',
  'a link to its folder',
] as const)('file bytes and thumbnail open for %s', async (reader) => {
  const row = await storedFile(
    reader === 'a teammate, for a Team file' ? '/Team' : '/creator-folder',
  );
  const headers =
    reader === 'its creator'
      ? creator.headers
      : reader === 'a teammate, for a Team file'
        ? teammate.headers
        : new Headers();
  const token =
    reader === 'a link to the file'
      ? await viewLink({ fileId: row.id })
      : reader === 'a link to its folder'
        ? await viewLink({ folderPath: '/creator-folder' })
        : null;
  for (const variant of ['content', 'thumbnail'] as const) {
    const response = await read(row, variant, headers, token);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      `https://blob.test/${variant === 'content' ? row.storagePath : row.thumbnailPath}`,
    );
  }
});

test('a teammate cannot delete, rename or restore a private file by its id', async () => {
  const row = await storedFile('/creator-folder');
  authState.headers = teammate.headers;
  expect(await deleteFiles([row.id])).toMatchObject({ ok: true, data: { removed: 0 } });
  expect(await renameFile(row.id, 'stolen')).toMatchObject({ ok: false });
  await db.update(file).set({ deletedAt: new Date() }).where(eq(file.id, row.id));
  expect(await restoreFiles([row.id])).toMatchObject({ ok: true, data: { restored: 0 } });
  const stored = requiredEntry(await db.select().from(file).where(eq(file.id, row.id)), 0);
  expect(stored.filename).toBe('private.txt');
});

test('an upload token is issued for the member’s own uploads and refused for another uploader’s path', async () => {
  for (const principal of [creator.userId, 'another-user']) {
    const response = await uploadTokenRoute(
      new Request('http://localhost/api/files/upload-token', {
        method: 'POST',
        headers: creator.headers,
        body: JSON.stringify({
          type: 'blob.generate-client-token',
          payload: {
            pathname: `ws/${workspaceId}/u-${principal}-file.txt`,
            clientPayload: null,
            multipart: false,
          },
        }),
      }),
    );
    expect(response.status).toBe(principal === creator.userId ? 200 : 403);
  }
});

test.each([
  'avatar',
  'workspace-icon',
] as const)('a %s opens for shared members from any active workspace, and never for outsiders', async (kind) => {
  const hash = 'a'.repeat(64);
  const ownerId = kind === 'avatar' ? creator.userId : workspaceId;
  if (kind === 'avatar') {
    await db
      .update(user)
      .set({ image: `/api/avatars/${ownerId}?v=${hash}` })
      .where(eq(user.id, ownerId));
  } else {
    await db
      .update(organization)
      .set({ logo: `/api/workspace-icons/${ownerId}?v=${hash}` })
      .where(eq(organization.id, organizationId));
  }
  // The creator switches to a second workspace of their own; the image must still open.
  const second = await createTestWorkspace({
    body: { name: 'Second', slug: `second-${randomUUID()}` },
    headers: creator.headers,
  });
  await auth.api.setActiveOrganization({
    body: { organizationId: second.id },
    headers: creator.headers,
  });
  const open = (headers: Headers) =>
    withRequestContext({ route: 'test/profile-image' }, () =>
      readProfileImage(new Request('http://localhost', { headers }), kind, ownerId),
    );
  for (const headers of [creator.headers, teammate.headers]) {
    expect((await open(headers)).status).toBe(307);
  }
  const stranger = await signInWithEmailCode('profile-outsider@files.test');
  await expect(open(stranger.headers)).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
});

test.each([
  'avatar',
  'workspace-icon',
] as const)('replacing a %s deletes only the old image it replaced', async (kind) => {
  const headers = kind === 'avatar' ? creator.headers : admin.headers;
  const ownerId = kind === 'avatar' ? creator.userId : workspaceId;
  const route = kind === 'avatar' ? 'avatars' : 'workspace-icons';
  const oldHash = 'c'.repeat(64);
  const previousUrl = `/api/${route}/${ownerId}?v=${oldHash}`;
  const setImage = (image: string) =>
    kind === 'avatar'
      ? db.update(user).set({ image }).where(eq(user.id, ownerId))
      : db.update(organization).set({ logo: image }).where(eq(organization.id, organizationId));
  const cleanup = (url: string) =>
    withRequestContext({ route: 'test/profile-cleanup' }, () =>
      processProfileImage(new Request('http://localhost', { headers }), {
        action: 'cleanup',
        kind,
        previousUrl: url,
      }),
    );
  // Still the current image: nothing is deleted.
  await setImage(previousUrl);
  await cleanup(previousUrl);
  expect(blobState.remove).not.toHaveBeenCalled();
  // Someone else's image path: nothing is deleted.
  await setImage(`/api/${route}/${ownerId}?v=${'d'.repeat(64)}`);
  await cleanup(`/api/${route}/another-owner?v=${oldHash}`);
  expect(blobState.remove).not.toHaveBeenCalled();
  await cleanup(previousUrl);
  expect(blobState.remove).toHaveBeenCalledWith(
    `${route}/${ownerId}/${oldHash}.webp`,
    expect.anything(),
  );
  blobState.remove.mockRejectedValueOnce(new Error('cleanup unavailable'));
  await expect(cleanup(previousUrl)).rejects.toMatchObject({ code: 'EXTERNAL_API_FAILED' });
});
