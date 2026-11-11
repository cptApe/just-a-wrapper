// What a teammate can and cannot see or change, and what removing a member revokes, on real Postgres.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { db } from '@/db';
import {
  artifact,
  artifactSave,
  file,
  folder,
  folderShare,
  session,
  sessionShare,
  skill,
  workspace,
} from '@/db/schema';
import { loadOwnedArtifact } from '@/features/files/api/artifact-access';
import { readFileContent } from '@/features/files/api/file-content';
import {
  deleteVisibleLibraryItem,
  ensureLibraryFolderPath,
  findVisibleLibraryFile,
  moveVisibleLibraryItem,
} from '@/features/files/api/library-operations';
import { listSessionArtifacts, listWorkspaceArtifacts } from '@/features/files/api/list-artifacts';
import { listSessionFiles } from '@/features/files/api/list-session-files';
import { shareFileScope } from '@/features/files/api/live-share';
import { loadFilesInScope, loadFolders } from '@/features/files/api/load';
import { saveArtifactToKnowledge } from '@/features/files/api/save-to-knowledge';
import { attachExistingUploadedFile } from '@/features/files/api/sync-metadata';
import { requireWritableFolder } from '@/features/files/lib/team-folder';
import {
  notifyIntegrationBroken,
  notifyTaskEvent,
} from '@/features/notifications/api/notify-task-events';
import { searchWorkspace } from '@/features/search/api/search';
import { sendSessionMessage } from '@/features/session-runtime/api/send-session-message';
import { anthropicEventPoster } from '@/features/sessions/api/anthropic-events';
import { authorizeSessionWriteForActor } from '@/features/sessions/api/session-access';
import { PRESET_SKILLS } from '@/features/skills/constants';
import { runAndPost } from '@/features/tools/api/dispatch-execution';
import { claimAnthropicCustomToolCalls } from '@/features/tools/api/tool-delivery-transitions';
import { bindTool } from '@/features/tools/lib/bind-tool';
import { getMemberDirectoryUsage } from '@/features/workspaces/api/members';
import { revokeMemberWorkspaceAccess } from '@/features/workspaces/api/revoke-member-workspace-access';
import { withRequestContext } from '@/lib/request-context';
import { requiredEntry } from '../support/required-entry';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { writeGrantForTest } from './helpers/session-grant';
import { makeTestDb, makeTestPool } from './helpers/test-db';

vi.mock('@/features/agents', () => ({
  getAnthropicClient: () => null,
  requireAnthropicClient: () => {
    throw new Error('Anthropic is unavailable');
  },
}));
const pool = makeTestPool();
const database = makeTestDb(pool);
let workspaceId: string;
let sessionId: string;
const alice = () => ({ workspaceId, userId: 'alice' });
const bob = () => ({ workspaceId, userId: 'bob' });
beforeAll(() => applyMigrations(database));
beforeEach(async () => {
  await truncateAll(database);
  await seedOrganization(database, 'privacy');
  for (const userId of ['alice', 'bob']) {
    await seedUser(database, userId);
    await database.execute(
      sql`insert into workspace_member (organization_id, user_id, composio_user_id) values ('privacy', ${userId}, ${userId})`,
    );
    await database.execute(
      sql`insert into member (id, organization_id, user_id, role, created_at) values (${userId}, 'privacy', ${userId}, 'member', now())`,
    );
  }
  workspaceId = requiredEntry(
    await db.insert(workspace).values({ organizationId: 'privacy', name: 'Privacy' }).returning(),
    0,
  ).id;
  sessionId = requiredEntry(
    await db
      .insert(session)
      .values({
        workspaceMemoryAccess: 'read_write',
        workspaceId,
        createdByUserId: 'alice',
        tier: 'default',
        kind: 'chat',
        anthropicSessionId: 'as_privacy',
      })
      .returning(),
    0,
  ).id;
});
afterAll(() => pool.end());

async function insertFile(userId: string, folderPath: string, filename: string) {
  return requiredEntry(
    await db
      .insert(file)
      .values({
        workspaceId,
        createdByUserId: userId,
        folderPath,
        filename,
        storagePath: `ws/${workspaceId}/${randomUUID()}`,
        source: 'user_upload',
        mimeType: 'text/plain',
        sizeBytes: 5,
        sessionId,
      })
      .returning(),
    0,
  );
}
async function insertArtifact() {
  return requiredEntry(
    await db
      .insert(artifact)
      .values({
        workspaceId,
        sessionId,
        anthropicFileId: 'af_private',
        filename: 'secret-output.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        downloadable: true,
        fileCreatedAt: new Date(),
      })
      .returning(),
    0,
  );
}

test('search never shows the private file names of a teammate or retired presets', async () => {
  await ensureLibraryFolderPath(alice(), '/Secret');
  await insertFile('alice', '/Secret', 'secret.txt');
  await insertFile('bob', '/', 'secret-mine.txt');
  await db.insert(skill).values({
    kind: 'preset',
    name: 'Wrapper Starter Pack',
    description: 'secret retired',
    status: 'ready',
  });
  const found = await withRequestContext({ route: 'test' }, () =>
    searchWorkspace({ ...bob(), query: 'secret', headers: new Headers() }),
  );
  expect(found.map((row) => row.title)).toEqual(['secret-mine.txt']);
});

test('the artifacts of a private chat stay hidden from teammates on every read', async () => {
  const output = await insertArtifact();
  const input = { workspaceId, viewerId: 'bob' };
  await expect(loadOwnedArtifact({ ...input, artifactId: output.id })).rejects.toMatchObject({
    code: 'ARTIFACT_NOT_FOUND',
  });
  expect(await listWorkspaceArtifacts(input)).toEqual([]);
  expect(await listSessionArtifacts({ ...input, anthropicSessionId: 'as_privacy' })).toEqual([]);
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  expect(await loadOwnedArtifact({ ...input, artifactId: output.id })).toMatchObject({
    id: output.id,
  });
  expect(await listWorkspaceArtifacts(input)).toHaveLength(1);
  await db
    .update(session)
    .set({ status: 'terminated', hiddenAt: new Date() })
    .where(eq(session.id, sessionId));
  expect(await listWorkspaceArtifacts(input)).toEqual([]);
  await expect(loadOwnedArtifact({ ...input, artifactId: output.id })).rejects.toMatchObject({
    code: 'ARTIFACT_NOT_FOUND',
  });
});

test('removing a member revokes their task and file share links in the same transaction', async () => {
  const target = await insertFile('alice', '/Team', 'shared.txt');
  await db.insert(folderShare).values({
    workspaceId,
    fileId: target.id,
    token: 'file-token',
    mode: 'view',
    createdByUserId: 'alice',
  });
  await db
    .insert(sessionShare)
    .values({ workspaceId, sessionId, token: 'task-token', createdByUserId: 'alice' });
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, 'privacy', 'alice'));
  expect(requiredEntry(await db.select().from(folderShare), 0).revokedAt).not.toBeNull();
  expect(requiredEntry(await db.select().from(sessionShare), 0).revokedAt).not.toBeNull();
});

test('a share link stops working once its file moves out of the Team folder', async () => {
  const target = await insertFile('alice', '/Team', 'shared.txt');
  await db.insert(folderShare).values({
    workspaceId,
    fileId: target.id,
    token: 'bob-token',
    mode: 'view',
    createdByUserId: 'bob',
  });
  const scope = () =>
    shareFileScope({ workspaceId, fileId: target.id, folderPath: '/Team', createdByUserId: 'bob' });
  expect(await loadFilesInScope(scope())).toHaveLength(1);
  await db.update(file).set({ folderPath: '/' }).where(eq(file.id, target.id));
  expect(await loadFilesInScope(scope())).toEqual([]);
  await expect(
    readFileContent(
      new Request('https://example.test/content?share=bob-token'),
      target.id,
      'content',
    ),
  ).rejects.toMatchObject({ code: 'ARTIFACT_NOT_FOUND' });
});

test('a member can open the folders above their own files inside the private folder of a teammate', async () => {
  await ensureLibraryFolderPath(alice(), '/Generated/Images');
  await ensureLibraryFolderPath(alice(), '/Generated-other');
  await insertFile('bob', '/Generated/Images', 'mine.png');
  expect((await loadFolders(workspaceId, 'bob')).map((row) => row.path)).toEqual([
    '/Generated',
    '/Generated/Images',
  ]);
});

test('a private save by a teammate does not show as saved for me', async () => {
  const output = await insertArtifact();
  const saved = await insertFile('alice', '/Artifacts', 'saved.txt');
  await db
    .insert(artifactSave)
    .values({ artifactId: output.id, userId: 'alice', fileId: saved.id });
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  expect(
    await loadOwnedArtifact({ workspaceId, artifactId: output.id, viewerId: 'bob' }),
  ).toMatchObject({ savedDriveFileId: null });
  expect(
    requiredEntry(
      await listSessionArtifacts({
        workspaceId,
        anthropicSessionId: 'as_privacy',
        viewerId: 'bob',
      }),
      0,
    ).savedDriveFileId,
  ).toBeNull();
  expect(
    await loadOwnedArtifact({ workspaceId, artifactId: output.id, viewerId: 'alice' }),
  ).toMatchObject({ savedDriveFileId: saved.id });
});

test('an ambiguous file path fails instead of picking a file for me', async () => {
  await insertFile('alice', '/', 'duplicate.txt');
  await insertFile('alice', '/', 'duplicate.txt');
  await expect(findVisibleLibraryFile(alice(), '/duplicate.txt')).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
});

test('the attachment list of a shared task leaves out private files of teammates', async () => {
  await insertFile('alice', '/', 'private.txt');
  await insertFile('bob', '/', 'mine.txt');
  const files = await listSessionFiles({
    workspaceId,
    anthropicSessionId: 'as_privacy',
    viewerId: 'bob',
  });
  expect(files.map((row) => row.filename)).toEqual(['mine.txt']);
});

test('a private scheduled task notifies only its creator', async () => {
  await database.execute(
    sql`insert into task (workspace_id, created_by_user_id, title, trigger_type, notification, tier) values (${workspaceId}, 'alice', 'Private schedule', 'event', 'app', 'default')`,
  );
  await database.execute(
    sql`update session set kind = 'task_run', task_id = (select id from task limit 1) where id = ${sessionId}`,
  );
  await withRequestContext({ route: 'test' }, () =>
    notifyTaskEvent({
      anthropicSessionId: 'as_privacy',
      event: 'task.completed',
      eventId: 'private-event',
    }),
  );
  const rows = (
    await database.execute(
      sql`select recipient_user_id from notification where idempotency_key = 'task.completed:private-event'`,
    )
  ).rows;
  expect(rows).toEqual([{ recipient_user_id: 'alice' }]);
});

test('a broken connection notifies only the person who connected it', async () => {
  await withRequestContext({ route: 'test' }, () =>
    notifyIntegrationBroken({
      anthropicSessionId: 'as_privacy',
      serverName: 'gmail',
      eventId: 'broken-event',
    }),
  );
  const rows = (
    await database.execute(
      sql`select recipient_user_id from notification where idempotency_key = 'integration-broken:broken-event'`,
    )
  ).rows;
  expect(rows).toEqual([{ recipient_user_id: 'alice' }]);
});

test('the member directory shows the same usage whoever is looking', async () => {
  expect(await getMemberDirectoryUsage('privacy')).toEqual({});
});

test('a reader of a shared chat cannot send messages or approve tools', async () => {
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  await expect(
    authorizeSessionWriteForActor({ sessionId, workspaceId, userId: 'bob' }),
  ).rejects.toMatchObject({ code: 'SESSION_NOT_WRITABLE' });
});

test('opening a folder above my files does not let me change the private folder of a teammate', async () => {
  await ensureLibraryFolderPath(alice(), '/Private/Child');
  await insertFile('bob', '/Private/Child', 'mine.txt');
  await expect(requireWritableFolder(workspaceId, 'bob', '/Private')).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
  expect(await moveVisibleLibraryItem(bob(), '/Private', '/Team/Exposed')).toBeNull();
  expect(await deleteVisibleLibraryItem(bob(), '/Private')).toBeNull();
});

test('removing a member trashes their private files and keeps their Team files', async () => {
  const privateFile = await insertFile('alice', '/', 'private.txt');
  const sharedFile = await insertFile('alice', '/Team', 'shared.txt');
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, 'privacy', 'alice'));
  const rows = await db.select().from(file);
  expect(rows.find((row) => row.id === privateFile.id)?.deletedAt).not.toBeNull();
  expect(rows.find((row) => row.id === sharedFile.id)?.deletedAt).toBeNull();
});

for (const scenario of ['removed', 'demoted'] as const) {
  test(`tool execution refuses a ${scenario} creator and stores FORBIDDEN`, async () => {
    if (scenario === 'removed')
      await database.execute(sql`delete from member where user_id = 'alice'`);
    await claimAnthropicCustomToolCalls(sessionId, [
      { toolUseId: 'privacy-tool', name: 'privacy_probe' },
    ]);
    let executed = false;
    const tool = bindTool({
      name: 'privacy_probe',
      description: 'Probe',
      riskLevel: 'safe',
      inputJsonSchema: { type: 'object' },
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => {
        executed = true;
        return { ok: true };
      },
    });
    const prepared = tool.prepare({});
    if (!prepared.success) throw prepared.error;
    const delivered: unknown[] = [];
    vi.spyOn(anthropicEventPoster, 'postCustomToolResult').mockImplementation(async (result) => {
      delivered.push(result);
    });
    vi.spyOn(anthropicEventPoster, 'isToolResultDelivered').mockResolvedValue(false);
    await withRequestContext({ route: 'test' }, () =>
      runAndPost(tool, prepared.data, 'privacy-tool', {
        sessionRowId: sessionId,
        anthropicSessionId: 'as_privacy',
        workspaceId,
        userId: 'bob',
        actorUserId: 'alice',
      }),
    );
    expect(executed).toBe(false);
    expect(delivered).toEqual([
      expect.objectContaining({
        isError: true,
        content: expect.objectContaining({ code: 'FORBIDDEN' }),
      }),
    ]);
  });
}

test('a reader of a shared chat cannot answer a pending approval', async () => {
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  // Approvals take a write grant, so the refusal happens where the grant is issued.
  await expect(
    authorizeSessionWriteForActor({ sessionId, workspaceId, userId: 'bob' }),
  ).rejects.toMatchObject({ code: 'SESSION_NOT_WRITABLE' });
});

test('saving an artifact again reuses my own saved copy even when a teammate saved it first', async () => {
  const output = await insertArtifact();
  const other = await insertFile('alice', '/Artifacts', output.filename);
  const own = await insertFile('bob', '/Artifacts', output.filename);
  await db.insert(artifactSave).values([
    { artifactId: output.id, userId: 'alice', fileId: other.id },
    { artifactId: output.id, userId: 'bob', fileId: own.id },
  ]);
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  expect(
    await saveArtifactToKnowledge({ workspaceId, userId: 'bob', artifactId: output.id }),
  ).toEqual({ savedDriveFileId: own.id, alreadySaved: true });
  expect(
    await saveArtifactToKnowledge({ workspaceId, userId: 'bob', artifactId: output.id }),
  ).toEqual({ savedDriveFileId: own.id, alreadySaved: true });
  expect(await db.select().from(file)).toHaveLength(2);
});

test('a creator demoted to member cannot send into a chat that writes workspace memory', async () => {
  await expect(
    sendSessionMessage({
      sessionId,
      text: 'Change workspace memory',
      dispatchPendingToolCalls: async () => {},
      caller: writeGrantForTest({
        workspaceId,
        organizationId: 'privacy',
        userId: 'alice',
        email: 'alice@example.test',
        name: 'Alice',
        workspaceName: 'Workspace',
        role: 'member',
        createdByUserId: 'alice',
        anthropicSessionId: 'as_privacy',
        sessionRowId: sessionId,
        permissionMode: 'ask',
        visibility: 'workspace',
        lastEventAt: null,
      }),
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('a reader of a shared chat cannot attach an existing upload', async () => {
  const upload = await insertFile('bob', '/', 'attachment.txt');
  await db.update(session).set({ visibility: 'workspace' }).where(eq(session.id, sessionId));
  await expect(
    attachExistingUploadedFile({ ...bob(), sessionId, fileId: upload.id, clientSizeBytes: 5 }),
  ).rejects.toMatchObject({ code: 'SESSION_NOT_WRITABLE' });
});

test('search finds a live preset skill', async () => {
  const preset = requiredEntry(PRESET_SKILLS, 0);
  await db
    .insert(skill)
    .values({ kind: 'preset', name: preset.name, description: 'livepresetprobe', status: 'ready' });
  const found = await withRequestContext({ route: 'test' }, () =>
    searchWorkspace({ ...bob(), query: 'livepresetprobe', headers: new Headers() }),
  );
  expect(found.map((row) => row.title)).toEqual([preset.name]);
});

test('removing a member keeps folders that still hold files of a teammate', async () => {
  await ensureLibraryFolderPath(alice(), '/Artifacts/Nested');
  await insertFile('bob', '/Artifacts/Nested', 'mine.txt');
  await db.transaction((tx) => revokeMemberWorkspaceAccess(tx, 'privacy', 'alice'));
  expect((await db.select().from(folder)).every((row) => row.deletedAt === null)).toBe(true);
  expect((await loadFolders(workspaceId, 'bob')).map((row) => row.path)).toContain('/Artifacts');
});
