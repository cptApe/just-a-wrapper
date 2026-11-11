import 'server-only';

import { createHash } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaManagedAgentsActor,
  BetaManagedAgentsMemoryVersion,
} from '@anthropic-ai/sdk/resources/beta/memory-stores/memory-versions';
import { AppError } from '@/lib/errors';
import type { DeletedMemoryNote, MemoryNote, MemoryNoteVersion } from '../lib/notes';
import type { MemoryTrashPage, MemoryVersionsPage } from '../types';
import { createNote, readNote, updateNoteContent } from './notes';

/** How long deleted notes stay restorable (matches the Files trash window). */
const MEMORY_TRASH_RETENTION_DAYS = 30;

const VERSIONS_PAGE_LIMIT = 30;

function actorOf(actor: BetaManagedAgentsActor | undefined): MemoryNoteVersion['actor'] {
  if (!actor) return 'app';
  switch (actor.type) {
    case 'session_actor':
      return 'agent';
    case 'user_actor':
      return 'user';
    case 'api_actor':
      return 'app';
  }
}

function toVersion(v: BetaManagedAgentsMemoryVersion): MemoryNoteVersion {
  return {
    id: v.id,
    operation: v.operation,
    createdAt: v.created_at,
    actor: actorOf(v.created_by),
    sizeBytes: v.content_size_bytes ?? null,
    path: v.path ?? null,
  };
}

/** One page of a note's history, newest first. */
export async function listNoteVersions(
  client: Anthropic,
  storeId: string,
  memoryId: string,
  cursor: string | null,
): Promise<MemoryVersionsPage> {
  const page = await client.beta.memoryStores.memoryVersions.list(storeId, {
    memory_id: memoryId,
    view: 'basic',
    limit: VERSIONS_PAGE_LIMIT,
    ...(cursor ? { page: cursor } : {}),
  });
  return {
    // Order within a page is pinned here (the API's list order is not
    // documented); pages themselves arrive in cursor order.
    versions: page.data.map(toVersion).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    nextCursor: page.next_page ?? null,
  };
}

/** A version's snapshot content, for the history panel's preview. */
export async function readVersionContent(
  client: Anthropic,
  storeId: string,
  versionId: string,
): Promise<{ content: string | null; version: MemoryNoteVersion }> {
  const v = await client.beta.memoryStores.memoryVersions.retrieve(versionId, {
    memory_store_id: storeId,
    view: 'full',
  });
  return { content: v.content ?? null, version: toVersion(v) };
}

// Restore writes a new head so the append-only history remains intact.
export async function restoreNoteVersion(
  client: Anthropic,
  storeId: string,
  memoryId: string,
  versionId: string,
  contentSha256: string,
): Promise<MemoryNote> {
  const snapshot = await client.beta.memoryStores.memoryVersions.retrieve(versionId, {
    memory_store_id: storeId,
    view: 'full',
  });
  if (snapshot.memory_id !== memoryId || snapshot.redacted_at) {
    throw new AppError('TOOL_INPUT_INVALID', 'Version does not belong to this note', {
      memoryId,
      versionId,
    });
  }
  const content = snapshot.content ?? null;
  const version = toVersion(snapshot);
  if (content === null) {
    throw new AppError('TOOL_INPUT_INVALID', 'this version has no restorable content', {
      versionId,
      operation: version.operation,
    });
  }
  return updateNoteContent(client, storeId, memoryId, content, {
    type: 'content_sha256',
    content_sha256: contentSha256,
  });
}

function trashCutoffIso(): string {
  return new Date(Date.now() - MEMORY_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Tombstones survive deletion. Redaction removes the path after restore so trash omits them.
export async function listDeletedNotes(
  client: Anthropic,
  storeId: string,
  cursor: string | null,
): Promise<MemoryTrashPage> {
  const page = await client.beta.memoryStores.memoryVersions.list(storeId, {
    operation: 'deleted',
    view: 'basic',
    limit: VERSIONS_PAGE_LIMIT,
    'created_at[gte]': trashCutoffIso(),
    ...(cursor ? { page: cursor } : {}),
  });

  const seen = new Set<string>();
  const notes: DeletedMemoryNote[] = [];
  for (const v of page.data) {
    if (v.redacted_at || !v.path) continue; // redacted = already restored (or scrubbed)
    if (seen.has(v.memory_id)) continue;
    seen.add(v.memory_id);
    notes.push({
      memoryId: v.memory_id,
      tombstoneVersionId: v.id,
      path: v.path,
      deletedAt: v.created_at,
      actor: actorOf(v.created_by),
    });
  }
  return { notes, nextCursor: page.next_page ?? null };
}

// Recreate content before redacting the tombstone. The provider assigns a fresh memory ID.
export async function restoreDeletedNote(
  client: Anthropic,
  storeId: string,
  deleted: { memoryId: string; tombstoneVersionId: string },
): Promise<MemoryNote> {
  const tombstone = await client.beta.memoryStores.memoryVersions.retrieve(
    deleted.tombstoneVersionId,
    {
      memory_store_id: storeId,
      view: 'basic',
    },
  );
  if (
    tombstone.operation !== 'deleted' ||
    tombstone.memory_id !== deleted.memoryId ||
    tombstone.redacted_at ||
    !tombstone.path ||
    tombstone.created_at < trashCutoffIso()
  ) {
    throw new AppError('TOOL_INPUT_INVALID', 'Deleted note is not restorable', {
      memoryId: deleted.memoryId,
    });
  }
  // Find the LATEST version with content (the state the note died in). The
  // versions list order is not documented, so scan the full lineage and pick
  // by timestamp rather than trusting page order.
  let cursor: string | null = null;
  let snapshot: string | null = null;
  let snapshotAt = '';
  do {
    const page = await client.beta.memoryStores.memoryVersions.list(storeId, {
      memory_id: deleted.memoryId,
      view: 'full',
      limit: VERSIONS_PAGE_LIMIT,
      ...(cursor ? { page: cursor } : {}),
    });
    for (const v of page.data) {
      if (
        v.operation !== 'deleted' &&
        !v.redacted_at &&
        typeof v.content === 'string' &&
        v.created_at > snapshotAt
      ) {
        snapshot = v.content;
        snapshotAt = v.created_at;
      }
    }
    cursor = page.next_page ?? null;
  } while (cursor);

  if (snapshot === null) {
    throw new AppError('TOOL_INPUT_INVALID', 'this note has no restorable content', {
      memoryId: deleted.memoryId,
    });
  }

  const restored = await createOrAdoptRestoredNote(client, storeId, tombstone.path, snapshot);
  await client.beta.memoryStores.memoryVersions.redact(tombstone.id, { memory_store_id: storeId });
  return restored;
}

// A retry after redaction failure adopts only identical content at the tombstone path.
async function createOrAdoptRestoredNote(
  client: Anthropic,
  storeId: string,
  path: string,
  content: string,
): Promise<MemoryNote> {
  try {
    return await createNote(client, storeId, path, content);
  } catch (cause) {
    if (!(cause instanceof AppError) || cause.code !== 'MEMORY_PATH_CONFLICT') throw cause;
    const expectedHash = createHash('sha256').update(content).digest('hex');
    for await (const remote of client.beta.memoryStores.memories.list(storeId, {
      view: 'basic',
      path_prefix: path,
    })) {
      if (
        remote.type === 'memory' &&
        remote.path === path &&
        remote.content_sha256 === expectedHash
      ) {
        const note = await readNote(client, storeId, remote.id);
        if (note.path === path && note.contentSha256 === expectedHash) return note;
      }
    }
    throw cause;
  }
}
