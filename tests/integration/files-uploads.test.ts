// Uploads: recording a stored file in the Library, uploads through an edit link, and mounting a file into a chat session.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  blobBytes: new TextEncoder().encode('test') as Uint8Array<ArrayBuffer>,
  upload: vi.fn(),
  remove: vi.fn(),
  addResource: vi.fn(),
}));
vi.mock('@/features/agents', () => {
  const client = {
    beta: {
      files: { upload: state.upload, delete: state.remove },
      sessions: { resources: { add: state.addResource } },
    },
  };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
vi.mock('@vercel/blob', () => ({
  put: async (pathname: string) => ({ pathname }),
  head: async () => ({ uploadedAt: new Date(), size: 1234, contentType: 'application/pdf' }),
  get: async () => ({ statusCode: 200, stream: new Response(state.blobBytes).body }),
  del: async () => {},
}));
vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});

import { file, folder, folderShare, session, workspace } from '@/db/schema';
import { attachFileToSession } from '@/features/files/api/attach-to-session';
import { linkFileOrigin } from '@/features/files/api/file-origin-transitions';
import { importDriveFile } from '@/features/files/api/import-drive-file';
import {
  attachExistingUploadedFile,
  syncSharedUpload,
  syncUploadedFile,
} from '@/features/files/api/sync-metadata';
import { resolveUploadAccess } from '@/features/files/api/upload-access';
import { requireOwnedUpload, uploadOwnerTag } from '@/features/files/lib/upload-policy';
import { withRequestContext } from '@/lib/request-context';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);
const USER = 'u_files';
const ORG = 'org_files';
let workspaceId: string;
let sessionRowId: string;

beforeAll(async () => applyMigrations(db));
afterAll(async () => {
  await pool.end();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  state.blobBytes = new TextEncoder().encode('test');
  state.upload.mockReset().mockImplementation(async ({ file }: { file: File }) => ({
    id: 'file_1',
    size_bytes: file.size,
  }));
  state.remove.mockReset().mockResolvedValue(undefined);
  state.addResource.mockReset().mockResolvedValue({ id: 'resource_1' });
  await truncateAll(db);
  await seedUser(db, USER);
  await seedOrganization(db, ORG);
  await db.execute(
    sql`insert into member (id, organization_id, user_id, role, created_at) values ('file-owner', ${ORG}, ${USER}, 'owner', now())`,
  );
  workspaceId = requiredEntry(
    await db.insert(workspace).values({ organizationId: ORG, name: 'Files Co' }).returning(),
    0,
  ).id;
  sessionRowId = requiredEntry(
    await db
      .insert(session)
      .values({
        workspaceMemoryAccess: 'read_write',
        workspaceId,
        createdByUserId: USER,
        tier: 'default',
        kind: 'chat',
        anthropicSessionId: 'session_1',
      })
      .returning({ id: session.id }),
    0,
  ).id;
});

/** A browser upload of `name`, stored by Blob at `path` with the uploader's tag. */
function upload(path: string, name: string, principal = USER) {
  return {
    storagePath: path.replace(/([^/]+)$/, `${uploadOwnerTag(principal)}-$1`),
    mimeType: 'application/pdf',
    sizeBytes: 1234,
    originalFileName: name,
  };
}

function syncLibraryUpload(item: ReturnType<typeof upload>) {
  const { folderPath } = requireOwnedUpload(workspaceId, USER, item.storagePath, '/');
  return syncUploadedFile({
    actor: { workspaceId, userId: USER },
    folderPath,
    upload: item,
    uploadSource: 'library',
  });
}

describe('Library uploads', () => {
  test('an upload is stored in the folder its path names, served from our own URL', async () => {
    const item = upload(`ws/${workspaceId}/Reports/q1.pdf`, 'q1.pdf');
    const { file: entry } = await syncLibraryUpload(item);
    expect(entry).toMatchObject({
      folderPath: '/Reports',
      filename: 'q1.pdf',
      url: `/api/files/${entry.id}/content`,
    });
    const row = requiredEntry(await db.select().from(file).where(eq(file.id, entry.id)), 0);
    expect(row).toMatchObject({
      storagePath: item.storagePath,
      workspaceId,
      source: 'user_upload',
    });
  });

  test.each([
    [
      'spaces, hyphens and brackets',
      'Reports/Q1 report-final (v2).pdf',
      'Q1 report-final (v2).pdf',
    ],
    [
      'a name Blob changed',
      'Chat uploads/4ihoh6seCN-Wrapper costs-7f2c6a.xlsx',
      'Wrapper costs.xlsx',
    ],
  ])('a file with %s keeps the name the person chose', async (_case, path, name) => {
    const { file: entry } = await syncLibraryUpload(upload(`ws/${workspaceId}/${path}`, name));
    expect(entry.filename).toBe(name);
  });

  test('a file name with a folder separator is refused', async () => {
    await expect(
      syncLibraryUpload(upload(`ws/${workspaceId}/Chat uploads/report.pdf`, 'folder/report.pdf')),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  test('an upload stored under another workspace is refused', async () => {
    expect(() =>
      requireOwnedUpload(
        workspaceId,
        USER,
        upload(`ws/${randomUUID()}/evil.pdf`, 'x').storagePath,
        '/',
      ),
    ).toThrow(/outside the allowed folder/);
  });

  test('a large file the agent made is saved even above the upload cap for people', async () => {
    const entry = await importDriveFile({
      workspaceId,
      userId: USER,
      bytes: new Uint8Array(26 * 1024 * 1024),
      filename: 'generated-video.mp4',
      mimeType: 'video/mp4',
      folderPath: '/Generated videos',
      source: 'agent_generated',
    });
    expect(entry.sizeBytes).toBe(26 * 1024 * 1024);
  });
});

describe('uploads through an edit link', () => {
  async function makeShare(mode: 'view' | 'edit', expiresAt: Date | null = null) {
    const token = randomUUID();
    const shareId = randomUUID();
    await db.insert(folder).values({ workspaceId, path: '/Inbox', createdByUserId: USER });
    await db.insert(folderShare).values({
      id: shareId,
      workspaceId,
      folderId: sql`(select id from folder where workspace_id = ${workspaceId} and path = '/Inbox' and deleted_at is null limit 1)`,
      mode,
      token,
      createdByUserId: USER,
      expiresAt,
    });
    return { token, shareId };
  }
  async function syncThroughLink(token: string, shareId: string, path: string) {
    const actor = await resolveUploadAccess(token, new Headers());
    if (actor.kind !== 'share') throw new Error('expected share');
    const item = upload(path, path.split('/').at(-1) ?? 'x', `share:${shareId}`);
    const { folderPath } = requireOwnedUpload(
      actor.workspaceId,
      actor.principal,
      item.storagePath,
      actor.folderPath,
    );
    return syncSharedUpload({ actor, folderPath, upload: item });
  }

  test('a guest upload lands in the shared folder', async () => {
    const { token, shareId } = await makeShare('edit');
    const entry = await syncThroughLink(token, shareId, `ws/${workspaceId}/Inbox/from-guest.pdf`);
    expect(entry.folderPath).toBe('/Inbox');
  });

  test('a guest upload outside the shared folder is refused', async () => {
    const { token, shareId } = await makeShare('edit');
    await expect(syncThroughLink(token, shareId, `ws/${workspaceId}/Other/x.pdf`)).rejects.toThrow(
      /outside the allowed folder/,
    );
  });

  test.each([
    ['view-only', 'view', null],
    ['expired', 'edit', new Date(Date.now() - 1000)],
  ] as const)('a guest cannot upload through a %s link', async (_case, mode, expiresAt) => {
    const { token, shareId } = await makeShare(mode, expiresAt);
    await expect(
      syncThroughLink(token, shareId, `ws/${workspaceId}/Inbox/x.pdf`),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('a link revoked after the guest opened it cannot create a folder or a file', async () => {
    const { token, shareId } = await makeShare('edit');
    const actor = await resolveUploadAccess(token, new Headers());
    if (actor.kind !== 'share') throw new Error('share actor missing');
    await db.update(folderShare).set({ revokedAt: new Date() }).where(eq(folderShare.id, shareId));
    await expect(
      syncSharedUpload({
        actor,
        folderPath: '/Inbox/new',
        upload: { storagePath: `ws/${workspaceId}/Inbox/new/a.pdf`, originalFileName: 'a.pdf' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.$count(file)).toBe(0);
    expect((await db.select().from(folder)).map((row) => row.path)).toEqual(['/Inbox']);
  });
});

describe('mounting a file into a chat', () => {
  async function storedFile() {
    return requiredEntry(
      await db
        .insert(file)
        .values({
          workspaceId,
          createdByUserId: USER,
          source: 'user_upload',
          storagePath: 'path',
          filename: 'a',
          mimeType: 'text/plain',
          sizeBytes: 4,
        })
        .returning(),
      0,
    ).id;
  }
  const attach = (fileId: string, names = { filename: 'a', mountFilename: 'a' }) =>
    attachFileToSession({
      sessionId: 'session_1',
      sessionRowId,
      fileId,
      ...names,
      mimeType: 'text/plain',
      workspaceId,
      storagePath: 'ws/wsA/a',
      sourceSizeBytes: 4,
    });

  test('the whole stored file is mounted at the name the chat shows', async () => {
    const result = await attach(await storedFile(), {
      filename: 'report.pdf',
      mountFilename: 'report (2).pdf',
    });
    expect(await state.upload.mock.calls.at(0)?.[0].file.text()).toBe('test');
    expect(state.addResource).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({ type: 'file', file_id: 'file_1', mount_path: '/report (2).pdf' }),
    );
    expect(result).toEqual({
      anthropicFileId: 'file_1',
      mountedPath: '/mnt/session/uploads/report (2).pdf',
    });
  });

  test('a failed mount reports the mount error even when removing the upload also fails', async () => {
    const mountError = new Error('mount unavailable');
    state.addResource.mockRejectedValueOnce(mountError);
    state.remove.mockRejectedValueOnce(new Error('delete unavailable'));
    await expect(attach(await storedFile())).rejects.toMatchObject({
      code: 'EXTERNAL_API_FAILED',
      cause: mountError,
    });
    expect(state.remove).toHaveBeenCalledOnce();
  });

  test('re-attaching a file already in the Library reuses its row instead of copying it', async () => {
    state.blobBytes = new Uint8Array(1234);
    const { file: persisted } = await syncLibraryUpload(
      upload(`ws/${workspaceId}/Chat uploads/report.pdf`, 'report.pdf'),
    );
    const remounted = await withRequestContext({ route: 'test/files-remount' }, () =>
      attachExistingUploadedFile({
        workspaceId,
        userId: USER,
        sessionId: sessionRowId,
        fileId: persisted.id,
        clientSizeBytes: persisted.sizeBytes,
      }),
    );
    expect(remounted).toMatchObject({
      fileId: persisted.id,
      durableUrl: `/api/files/${persisted.id}/content`,
    });
    expect(state.addResource).toHaveBeenCalledOnce();
    expect(await db.$count(file)).toBe(1);
  });

  test('a file keeps the chat it first came from, and a deleted file gains none', async () => {
    const fileId = await storedFile();
    expect(await linkFileOrigin(fileId, sessionRowId)).toBe('linked');
    expect(await linkFileOrigin(fileId, sessionRowId)).toBe('unchanged');
    await db
      .update(file)
      .set({ sessionId: null, deletedAt: new Date() })
      .where(eq(file.id, fileId));
    expect(await linkFileOrigin(fileId, sessionRowId)).toBe('unchanged');
  });
});
