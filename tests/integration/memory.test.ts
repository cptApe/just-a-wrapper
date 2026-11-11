// Memory stores and notes on real Postgres and the real Anthropic SDK: restores, store links and races.
// HTTP responses are controlled at fetch; no feature or database function is mocked.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { integrationCleanup, workspace, workspaceMember } from '@/db/schema';
import { drainMemberCleanups } from '@/features/integrations/api/member-cleanup';
import { deleteNote } from '@/features/memory/api/notes';
import {
  areMemoryStoresProvisioned,
  ensureMemoryStores,
} from '@/features/memory/api/provision-stores';
import { provisionStore } from '@/features/memory/api/store-transitions';
import { restoreDeletedNote, restoreNoteVersion } from '@/features/memory/api/versions';
import { revokeMemberWorkspaceAccess } from '@/features/workspaces/api/revoke-member-workspace-access';
import { applyMigrations, seedOrganization, seedUser, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const pool = makeTestPool();
const db = makeTestDb(pool);
const notes = new Map<string, { id: string; path: string; content: string }>();
const stores: { id: string; name: string; metadata: Record<string, string> }[] = [];
let creates = 0;
let tombstoneRedacted = false;
let storeLists = 0;
let deleteStatus = 200;
let redactions = 0;
let failRedaction = false;
let failUserStore = false;
vi.mock('@/features/agents', () => {
  const boundary = {
    getAnthropicClient: () => client,
  };
  return { ...boundary, requireAnthropicClient: boundary.getAnthropicClient };
});
let tombstoneAge = new Date().toISOString();
let workspaceId: string;
let lastPrecondition: unknown;
let beforeStoreResponse: (() => Promise<void>) | null = null;
const client = new Anthropic({
  apiKey: 'test',
  maxRetries: 0,
  fetch: async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    const id = parts.at(-1) ?? '';
    const body = request.method === 'POST' ? await request.text() : '';
    if (url.pathname.endsWith('/vaults') && request.method === 'GET')
      return Response.json({ data: [], has_more: false, next_page: null });
    if (url.pathname.endsWith('/memory_stores')) {
      if (request.method === 'GET') {
        storeLists += 1;
        return Response.json({ data: stores, has_more: false, next_page: null });
      }
      const fields = z
        .object({ name: z.string(), metadata: z.record(z.string(), z.string()) })
        .parse(JSON.parse(body));
      if (fields.name === 'user' && failUserStore)
        return Response.json(
          { error: { type: 'api_error', message: 'Unavailable' } },
          { status: 500 },
        );
      const store = { id: `store_${stores.length}`, ...fields };
      stores.push(store);
      if (beforeStoreResponse) await beforeStoreResponse();
      return Response.json(store);
    }
    if (request.method === 'DELETE' && parts.at(-2) === 'memory_stores') {
      if (deleteStatus !== 200)
        return Response.json(
          { error: { type: 'api_error', message: 'Cleanup failed' } },
          { status: deleteStatus },
        );
      const index = stores.findIndex((store) => store.id === id);
      if (index >= 0) stores.splice(index, 1);
      return Response.json({ id, type: 'memory_store_deleted' });
    }
    if (id === 'redact') {
      redactions += 1;
      if (failRedaction) {
        failRedaction = false;
        return Response.json(
          { error: { type: 'api_error', message: 'Unavailable' } },
          { status: 500 },
        );
      }
      tombstoneRedacted = true;
      return Response.json({ id: parts.at(-2), redacted_at: new Date().toISOString() });
    }
    if (url.pathname.includes('memory_versions')) {
      if (id === 'memory_versions')
        return Response.json({
          data: [
            {
              id: 'snapshot',
              memory_id: 'original',
              operation: 'created',
              content: 'Remember me',
              created_at: tombstoneAge,
            },
          ],
          has_more: false,
          next_page: null,
        });
      return Response.json({
        id,
        memory_id: id === 'wrong' ? 'another-note' : 'original',
        operation: id === 'tombstone' ? 'deleted' : 'modified',
        redacted_at: id === 'tombstone' && tombstoneRedacted ? new Date().toISOString() : null,
        path: '/original.md',
        created_at: tombstoneAge,
        content: id === 'tombstone' ? null : 'Remember me',
      });
    }
    if (id === 'memories') {
      if (request.method === 'GET')
        return Response.json({
          data: [...notes.values()].map(noteResponse),
          has_more: false,
          next_page: null,
        });
      const fields = z.object({ path: z.string(), content: z.string() }).parse(JSON.parse(body));
      if ([...notes.values()].some((note) => note.path === fields.path))
        return Response.json(
          { error: { type: 'memory_path_conflict_error', message: 'memory path already exists' } },
          { status: 409 },
        );
      const note = { id: `new_${++creates}`, ...fields };
      notes.set(note.id, note);
      return Response.json(noteResponse(note));
    }
    const note = notes.get(id);
    if (request.method === 'POST') {
      const fields = z
        .object({
          path: z.string().optional(),
          content: z.string().optional(),
          precondition: z.unknown().optional(),
        })
        .parse(JSON.parse(body));
      lastPrecondition = fields.precondition;
      if (fields.precondition)
        return Response.json(
          { error: { type: 'memory_precondition_failed_error', message: 'Changed' } },
          { status: 409 },
        );
      if (note && fields.path) {
        if ([...notes.values()].some((other) => other.id !== note.id && other.path === fields.path))
          return Response.json(
            { error: { type: 'memory_path_conflict_error', message: 'Path occupied' } },
            { status: 409 },
          );
        note.path = fields.path;
      }
    }
    if (request.method === 'DELETE') {
      if (
        url.searchParams.has('expected_content_sha256') &&
        url.searchParams.get('expected_content_sha256') !== 'a'.repeat(64)
      )
        return Response.json(
          { error: { type: 'memory_precondition_failed_error', message: 'Changed' } },
          { status: 409 },
        );
      notes.delete(id);
      return Response.json({ id });
    }
    return note
      ? Response.json(noteResponse(note))
      : Response.json({ error: { type: 'not_found_error', message: 'Missing' } }, { status: 404 });
  },
});
function noteResponse(note: { id: string; path: string; content: string }) {
  return {
    ...note,
    type: 'memory',
    content_sha256: createHash('sha256').update(note.content).digest('hex'),
    content_size_bytes: note.content.length,
    created_at: tombstoneAge,
    updated_at: tombstoneAge,
  };
}
beforeAll(async () => applyMigrations(db));
afterAll(async () => pool.end());
beforeEach(async () => {
  await truncateAll(db);
  stores.length = 0;
  notes.clear();
  creates = 0;
  tombstoneRedacted = false;
  storeLists = 0;
  deleteStatus = 200;
  beforeStoreResponse = null;
  redactions = 0;
  failRedaction = false;
  failUserStore = false;
  tombstoneAge = new Date().toISOString();
  await seedOrganization(db, 'memory-recovery');
  const row = (
    await db
      .insert(workspace)
      .values({ organizationId: 'memory-recovery', name: 'Memory' })
      .returning()
  ).at(0);
  if (!row) throw new Error('Missing workspace');
  workspaceId = row.id;
});
const owner = { organizationId: 'memory-recovery', userId: null };
const deleted = { memoryId: 'original', tombstoneVersionId: 'tombstone' };

test('restoring a deleted note uses its tombstone and finishes after a failed redaction', async () => {
  failRedaction = true;
  await expect(restoreDeletedNote(client, 'store', deleted)).rejects.toThrow();
  expect([...notes.values()].map((note) => note.path)).toEqual(['/original.md']);
  const restored = await restoreDeletedNote(client, 'store', deleted);
  expect(restored.path).toBe('/original.md');
  expect(creates).toBe(1);
  await expect(restoreDeletedNote(client, 'store', deleted)).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
  expect(creates).toBe(1);
  expect(redactions).toBe(2);
});

test('an expired or mismatched tombstone cannot restore a note', async () => {
  tombstoneAge = '2000-01-01T00:00:00Z';
  await expect(restoreDeletedNote(client, 'store', deleted)).rejects.toMatchObject({
    code: 'TOOL_INPUT_INVALID',
  });
  tombstoneAge = new Date().toISOString();
  await expect(
    restoreDeletedNote(client, 'store', { ...deleted, memoryId: 'someone-else' }),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  expect(creates).toBe(0);
});

test('a restore onto changed content leaves no extra note behind', async () => {
  notes.set('replacement', { id: 'replacement', path: '/original.md', content: 'New content' });
  await expect(restoreDeletedNote(client, 'store', deleted)).rejects.toMatchObject({
    code: 'MEMORY_PATH_CONFLICT',
  });
  expect(creates).toBe(0);
  expect([...notes.values()]).toEqual([
    { id: 'replacement', path: '/original.md', content: 'New content' },
  ]);
  expect(redactions).toBe(0);
});

test('restoring a version from another note is refused and a restore only applies on the current version', async () => {
  await expect(
    restoreNoteVersion(client, 'store', 'original', 'wrong', 'b'.repeat(64)),
  ).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  await expect(
    restoreNoteVersion(client, 'store', 'original', 'snapshot', 'b'.repeat(64)),
  ).rejects.toMatchObject({ code: 'MEMORY_EDIT_CONFLICT' });
  expect(lastPrecondition).toEqual({ type: 'content_sha256', content_sha256: 'b'.repeat(64) });
});

test('a retry after a failed link reuses the store already created instead of making another', async () => {
  await db.execute(
    sql`create function reject_memory_link() returns trigger language plpgsql as $$ begin raise exception 'link unavailable'; end $$`,
  );
  await db.execute(
    sql`create trigger reject_memory_link before update on workspace for each row execute function reject_memory_link()`,
  );
  const target = { kind: 'workspace' as const, id: workspaceId };
  const params = { name: 'workspace', description: 'Shared', metadata: {} };
  try {
    await expect(provisionStore(client, target, params)).rejects.toThrow();
  } finally {
    await db.execute(sql`drop trigger reject_memory_link on workspace`);
    await db.execute(sql`drop function reject_memory_link()`);
  }
  expect(stores.length).toBe(1);
  await provisionStore(client, target, params);
  expect(stores.length).toBe(1);
  expect(
    (await db.select().from(workspace).where(eq(workspace.id, workspaceId))).at(0)
      ?.workspaceMemoryStoreId,
  ).toBe(stores.at(0)?.id);
});

test('a workspace already linked to a store never creates a second one', async () => {
  await db
    .update(workspace)
    .set({ workspaceMemoryStoreId: 'winner' })
    .where(eq(workspace.id, workspaceId));
  stores.push({
    id: 'loser',
    name: 'workspace',
    metadata: { provision_key: `workspace:${workspaceId}` },
  });
  await provisionStore(
    client,
    { kind: 'workspace', id: workspaceId },
    { name: 'workspace', description: 'Shared', metadata: {} },
  );
  expect(stores).toHaveLength(1);
  expect(storeLists).toBe(0);
  expect(
    (await db.select().from(workspace).where(eq(workspace.id, workspaceId))).at(0)
      ?.workspaceMemoryStoreId,
  ).toBe('winner');
});

test('a failure linking the second store keeps the first store link', async () => {
  await seedUser(db, 'owner');
  await db.insert(workspaceMember).values({
    organizationId: owner.organizationId,
    userId: 'owner',
    composioUserId: 'composio-owner',
  });
  failUserStore = true;
  await expect(
    ensureMemoryStores({ organizationId: owner.organizationId, ownerUserId: 'owner' }),
  ).rejects.toThrow();
  const first = (await db.select().from(workspace).where(eq(workspace.id, workspaceId))).at(
    0,
  )?.workspaceMemoryStoreId;
  expect(first).toBeTruthy();
  failUserStore = false;
  await ensureMemoryStores({ organizationId: owner.organizationId, ownerUserId: 'owner' });
  const member = (
    await db.select().from(workspaceMember).where(eq(workspaceMember.userId, 'owner'))
  ).at(0);
  expect(member?.userMemoryStoreId).toBeTruthy();
  await provisionStore(
    client,
    { kind: 'member', organizationId: owner.organizationId, userId: 'owner' },
    { name: 'user', description: 'Personal', metadata: {} },
  );
  expect(
    (await db.select().from(workspaceMember).where(eq(workspaceMember.userId, 'owner'))).at(0)
      ?.userMemoryStoreId,
  ).toBe(member?.userMemoryStoreId);
  expect(stores.length).toBe(2);
});

test('two workspace store links at once keep exactly one', async () => {
  beforeStoreResponse = async () => {
    await db
      .update(workspace)
      .set({ workspaceMemoryStoreId: 'winner' })
      .where(eq(workspace.id, workspaceId));
  };
  await provisionStore(
    client,
    { kind: 'workspace', id: workspaceId },
    { name: 'workspace', description: 'Shared', metadata: {} },
  );
  expect(stores).toEqual([]);
  expect(
    (await db.select().from(workspace).where(eq(workspace.id, workspaceId))).at(0)
      ?.workspaceMemoryStoreId,
  ).toBe('winner');
});

test('two personal store links at once keep exactly one', async () => {
  await seedUser(db, 'owner');
  await db.insert(workspaceMember).values({
    organizationId: owner.organizationId,
    userId: 'owner',
    composioUserId: 'composio-owner',
  });
  beforeStoreResponse = async () => {
    await db
      .update(workspaceMember)
      .set({ userMemoryStoreId: 'winner' })
      .where(eq(workspaceMember.userId, 'owner'));
  };
  await provisionStore(
    client,
    { kind: 'member', organizationId: owner.organizationId, userId: 'owner' },
    { name: 'user', description: 'Personal', metadata: {} },
  );
  expect(stores).toEqual([]);
  expect(
    (await db.select().from(workspaceMember).where(eq(workspaceMember.userId, 'owner'))).at(0)
      ?.userMemoryStoreId,
  ).toBe('winner');
});

test('discarding an empty draft cannot delete a note someone just edited', async () => {
  notes.set('changed', { id: 'changed', path: '/Untitled.md', content: 'Someone edited this' });
  await expect(deleteNote(client, 'store', 'changed', 'b'.repeat(64))).rejects.toMatchObject({
    code: 'MEMORY_EDIT_CONFLICT',
  });
  expect(notes.has('changed')).toBe(true);
});

for (const status of [404, 500]) {
  test(`a losing store link that fails cleanup with ${status} keeps the winning link`, async () => {
    deleteStatus = status;
    beforeStoreResponse = async () => {
      await db
        .update(workspace)
        .set({ workspaceMemoryStoreId: 'winner' })
        .where(eq(workspace.id, workspaceId));
    };
    await expect(
      provisionStore(
        client,
        { kind: 'workspace', id: workspaceId },
        { name: 'workspace', description: 'Shared', metadata: {} },
      ),
    ).resolves.toBeUndefined();
    expect(
      (await db.select().from(workspace).where(eq(workspace.id, workspaceId))).at(0)
        ?.workspaceMemoryStoreId,
    ).toBe('winner');
  });
}

test('checking whether memory is ready never creates a store', async () => {
  await seedUser(db, 'owner');
  await db
    .insert(workspaceMember)
    .values({ organizationId: owner.organizationId, userId: 'owner', composioUserId: 'owner' });
  expect(
    await areMemoryStoresProvisioned({
      organizationId: owner.organizationId,
      ownerUserId: 'owner',
    }),
  ).toBe(false);
  expect(stores).toEqual([]);
  expect(storeLists).toBe(0);
});

test('a member who rejoins before cleanup gets a fresh store and the old one is erased', async () => {
  await seedUser(db, 'owner');
  const target = { kind: 'member' as const, organizationId: owner.organizationId, userId: 'owner' };
  const params = { name: 'user', description: 'Personal', metadata: {} };
  await db.insert(workspaceMember).values({ ...target, composioUserId: 'membership-1' });
  await provisionStore(client, target, params);
  const removed = (await db.select().from(workspaceMember)).at(0)?.userMemoryStoreId;
  expect(removed).toBeTruthy();
  await db.transaction((tx) =>
    revokeMemberWorkspaceAccess(tx, owner.organizationId, target.userId),
  );
  await db.insert(workspaceMember).values({ ...target, composioUserId: 'membership-2' });
  await provisionStore(client, target, params);
  await expect(drainMemberCleanups({ kind: 'members', ids: ['membership-1'] })).resolves.toEqual({
    completed: 1,
    failed: 0,
  });
  expect(await db.select().from(integrationCleanup)).toEqual([]);
  const current = (await db.select().from(workspaceMember)).at(0)?.userMemoryStoreId;
  expect(current).toBeTruthy();
  expect(current).not.toBe(removed);
  expect(stores.map((store) => store.id)).toEqual([current]);
});
