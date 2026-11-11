// Session outputs (artifacts): who can open one, and how each person's saved Library copy stays their own.
vi.hoisted(() => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_teststore_testsecret');
});
vi.mock('@/features/agents', () => {
  const client = { beta: { files: { download: async () => new Response('output') } } };
  return { getAnthropicClient: () => client, requireAnthropicClient: () => client };
});
vi.mock('@vercel/blob', () => ({
  put: async (pathname: string) => ({ pathname }),
  del: async () => {},
}));

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { db as appDb } from '@/db';
import { artifact, artifactSave, file } from '@/db/schema';
import { loadOwnedArtifact } from '@/features/files/api/artifact-access';
import { claimArtifactSave, mirrorArtifacts } from '@/features/files/api/artifact-transitions';
import { listSessionArtifacts } from '@/features/files/api/list-artifacts';
import { saveArtifactToKnowledge } from '@/features/files/api/save-to-knowledge';
import { transitionFiles } from '@/features/files/api/trash-transitions';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);

beforeAll(async () => applyMigrations(db));
beforeEach(async () => truncateAll(db));
afterAll(async () => pool.end());

async function seedWorkspace(orgId: string, userId: string): Promise<string> {
  await seedUser(db, userId);
  await seedOrganization(db, orgId);
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into workspace (organization_id, name) values (${orgId}, ${orgId}) returning id`,
  );
  return requiredEntry(rows, 0).id;
}

async function seedSession(workspaceId: string, userId: string): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into session (workspace_memory_access, workspace_id, tier, created_by_user_id, kind, anthropic_session_id)
        values ('read_write', ${workspaceId}, 'default', ${userId}, 'chat', ${`sess_${workspaceId}`})
        returning id`,
  );
  return requiredEntry(rows, 0).id;
}

async function seedArtifact(workspaceId: string, sessionRowId: string, fileId: string) {
  const { rows } = await db.execute<{ id: string }>(
    sql`insert into artifact (workspace_id, session_id, anthropic_file_id, filename, mime_type,
                              size_bytes, downloadable, file_created_at)
        values (${workspaceId}, ${sessionRowId}, ${fileId}, 'report.pdf', 'application/pdf',
                1024, true, now())
        returning id`,
  );
  return requiredEntry(rows, 0).id;
}

// An output of alice's chat that she shared with the workspace, so bob can see it too.
async function sharedOutput() {
  const workspaceId = await seedWorkspace('save-org', 'alice');
  await seedUser(db, 'bob');
  const sessionId = await seedSession(workspaceId, 'alice');
  await db.execute(sql`update session set visibility = 'workspace' where id = ${sessionId}`);
  const artifactId = await seedArtifact(workspaceId, sessionId, 'shared-output');
  const savedFor = async (viewerId: string) =>
    (
      await listSessionArtifacts({
        anthropicSessionId: `sess_${workspaceId}`,
        workspaceId,
        viewerId,
      })
    ).at(0)?.savedDriveFileId ?? null;
  return { workspaceId, sessionId, artifactId, savedFor };
}

test('another workspace’s output and an unknown id are both not found; the owner opens it', async () => {
  const wsA = await seedWorkspace('org_a', 'user_a');
  const wsB = await seedWorkspace('org_b', 'user_b');
  const artifactB = await seedArtifact(wsB, await seedSession(wsB, 'user_b'), 'file_b1');
  for (const artifactId of [artifactB, '00000000-0000-0000-0000-000000000000']) {
    await expect(
      loadOwnedArtifact({ artifactId, viewerId: 'user_a', workspaceId: wsA }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
  }
  await expect(
    loadOwnedArtifact({ artifactId: artifactB, viewerId: 'user_b', workspaceId: wsB }),
  ).resolves.toMatchObject({ id: artifactB, anthropicFileId: 'file_b1', downloadable: true });
});

test('the database refuses a second row for the same Anthropic output', async () => {
  const ws = await seedWorkspace('org_b', 'user_b');
  const session = await seedSession(ws, 'user_b');
  await seedArtifact(ws, session, 'file_dup');
  // The driver wraps the Postgres error, so look for the unique violation along the cause chain.
  await expect(seedArtifact(ws, session, 'file_dup')).rejects.toSatisfy((error: unknown) => {
    for (let e = error; e instanceof Error; e = e.cause) {
      if (/duplicate key|unique/i.test(e.message)) return true;
    }
    return false;
  });
});

test('refreshing outputs from Anthropic updates the row instead of adding another', async () => {
  const workspaceId = await seedWorkspace('org', 'owner');
  const sessionId = await seedSession(workspaceId, 'owner');
  const metadata = {
    id: 'remote',
    type: 'file' as const,
    filename: 'draft',
    mime_type: 'text/plain',
    size_bytes: 1,
    created_at: new Date().toISOString(),
    downloadable: false,
  };
  const scope = { sessionId, workspaceId };
  expect(await mirrorArtifacts(scope, [metadata, metadata])).toBe(1);
  expect(
    await mirrorArtifacts(scope, [
      { ...metadata, filename: 'final', size_bytes: 2, downloadable: true },
    ]),
  ).toBe(0);
  expect(
    await db
      .select({ filename: artifact.filename, downloadable: artifact.downloadable })
      .from(artifact),
  ).toEqual([{ filename: 'final', downloadable: true }]);
});

test('two teammates who save one shared output each get and see their own copy', async () => {
  const { workspaceId, artifactId, savedFor } = await sharedOutput();
  const aliceSave = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'alice' });
  expect(await savedFor('bob')).toBeNull();
  const bobSave = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'bob' });
  expect(bobSave.alreadySaved).toBe(false);
  expect(bobSave.savedDriveFileId).not.toBe(aliceSave.savedDriveFileId);
  const owner = await db.execute(
    sql`select created_by_user_id from file where id = ${bobSave.savedDriveFileId}`,
  );
  expect(owner.rows).toEqual([{ created_by_user_id: 'bob' }]);
  expect(await savedFor('alice')).toBe(aliceSave.savedDriveFileId);
  expect(await savedFor('bob')).toBe(bobSave.savedDriveFileId);
  expect(await loadOwnedArtifact({ artifactId, workspaceId, viewerId: 'bob' })).toMatchObject({
    savedDriveFileId: bobSave.savedDriveFileId,
  });
});

test('saving an output twice returns the same copy even after it was renamed and moved', async () => {
  const { workspaceId, artifactId } = await sharedOutput();
  const first = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'bob' });
  await db.execute(
    sql`update file set filename = 'renamed.pdf', folder_path = '/' where id = ${first.savedDriveFileId}`,
  );
  expect(await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'bob' })).toEqual({
    savedDriveFileId: first.savedDriveFileId,
    alreadySaved: true,
  });
  const copies = await db.execute(sql`select id from file where created_by_user_id = 'bob'`);
  expect(copies.rows).toHaveLength(1);
});

test('deleting my saved copy clears my saved state only, and saving again makes a new copy', async () => {
  const { workspaceId, artifactId, savedFor } = await sharedOutput();
  const aliceSave = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'alice' });
  const bobSave = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'bob' });
  await transitionFiles(appDb, eq(file.id, aliceSave.savedDriveFileId), new Date());
  expect(await savedFor('alice')).toBeNull();
  expect(await savedFor('bob')).toBe(bobSave.savedDriveFileId);
  const again = await saveArtifactToKnowledge({ workspaceId, artifactId, userId: 'alice' });
  expect(again.alreadySaved).toBe(false);
  expect(again.savedDriveFileId).not.toBe(aliceSave.savedDriveFileId);
});

test('a save claim keeps its first copy and is refused once that copy is deleted', async () => {
  const { workspaceId, artifactId } = await sharedOutput();
  const fileId = randomUUID();
  await db.insert(file).values({
    id: fileId,
    workspaceId,
    createdByUserId: 'alice',
    source: 'session_output',
    storagePath: 'ws/import',
    filename: 'a',
    mimeType: 'text/plain',
    sizeBytes: 1,
  });
  const save = { artifactId, userId: 'alice', fileId };
  expect(await claimArtifactSave(save)).toEqual({ fileId, storagePath: 'ws/import' });
  expect(await claimArtifactSave(save)).toEqual({ fileId, storagePath: 'ws/import' });
  await transitionFiles(appDb, eq(file.id, fileId), new Date());
  expect(await db.select().from(artifactSave)).toEqual([]);
  expect(await claimArtifactSave(save)).toBeNull();
});
