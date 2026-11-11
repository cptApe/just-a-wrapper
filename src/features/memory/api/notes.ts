import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { APIError } from '@anthropic-ai/sdk';
import type {
  BetaManagedAgentsMemory,
  BetaManagedAgentsPrecondition,
} from '@anthropic-ai/sdk/resources/beta/memory-stores/memories';
import { AppError } from '@/lib/errors';
import { MEMORY_EDIT_CONFLICT_MESSAGE } from '../constants';
import { isValidNotePath, type MemoryNote } from '../lib/notes';
import type { MemoryNotesPage } from '../types';

// Map note CRUD and update preconditions to Anthropic memory documents.
// The upstream store is authoritative; keep no local document copy.

/** Basic (no content) pages for the Browse view. */
const NOTES_BASIC_PAGE_LIMIT = 100;

function toNote(memory: BetaManagedAgentsMemory): MemoryNote {
  return {
    id: memory.id,
    contentSha256: memory.content_sha256,
    path: memory.path,
    sizeBytes: memory.content_size_bytes,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    content: memory.content ?? null,
  };
}

// A trailing-slash prefix scopes a folder; depth 1 returns deeper paths as folder markers.
export async function listNotesPage(
  client: Anthropic,
  storeId: string,
  args: {
    cursor: string | null;
    pathPrefix: string | null;
    depth: number | null;
  },
): Promise<MemoryNotesPage> {
  const page = await client.beta.memoryStores.memories.list(storeId, {
    view: 'basic',
    limit: NOTES_BASIC_PAGE_LIMIT,
    ...(args.cursor ? { page: args.cursor } : {}),
    ...(args.pathPrefix ? { path_prefix: args.pathPrefix } : {}),
    // Depth filtering requires order_by:path or the API rejects the request.
    ...(args.depth !== null ? { depth: args.depth, order_by: 'path' } : {}),
  });

  const notes: MemoryNote[] = [];
  const folders: string[] = [];
  for (const item of page.data) {
    if (item.type === 'memory') notes.push(toNote(item));
    // `memory_prefix` paths carry a trailing slash — normalize it away.
    else folders.push(item.path.replace(/\/$/, ''));
  }
  return { notes, folders, nextCursor: page.next_page ?? null };
}

/** Read one note with content. */
export async function readNote(
  client: Anthropic,
  storeId: string,
  memoryId: string,
): Promise<MemoryNote> {
  const memory = await client.beta.memoryStores.memories.retrieve(memoryId, {
    memory_store_id: storeId,
    view: 'full',
  });
  return toNote(memory);
}

function assertNotePath(path: string): void {
  if (!isValidNotePath(path)) {
    throw new AppError('TOOL_INPUT_INVALID', 'invalid note path', { path });
  }
}

/** Create a note at a path (400s → friendly error when the path is taken). */
export async function createNote(
  client: Anthropic,
  storeId: string,
  path: string,
  content: string,
): Promise<MemoryNote> {
  assertNotePath(path);
  try {
    const memory = await client.beta.memoryStores.memories.create(storeId, {
      path,
      content,
      view: 'full',
    });
    return toNote(memory);
  } catch (error) {
    if (isMemoryPathConflict(error)) {
      throw new AppError(
        'MEMORY_PATH_CONFLICT',
        'A note with that name already exists. Try creating it again.',
        { path, storeId },
        { cause: error },
      );
    }
    throw error;
  }
}

function isMemoryPreconditionFailure(error: unknown): boolean {
  // APIError.error is broader than the SDK's ErrorType union, which omits memory error types.
  if (!(error instanceof APIError) || error.status !== 409) return false;
  const body = error.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const detail = body.error;
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'type' in detail &&
    detail.type === 'memory_precondition_failed_error'
  );
}

function isMemoryPathConflict(error: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 409) return false;
  const body = error.error;
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const detail = body.error;
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'type' in detail &&
    detail.type === 'memory_path_conflict_error'
  );
}

/** Update content with an explicit editor precondition or intentional overwrite. */
export async function updateNoteContent(
  client: Anthropic,
  storeId: string,
  memoryId: string,
  content: string,
  base: BetaManagedAgentsPrecondition | 'unguarded-overwrite',
): Promise<MemoryNote> {
  try {
    const memory = await client.beta.memoryStores.memories.update(memoryId, {
      memory_store_id: storeId,
      content,
      ...(base === 'unguarded-overwrite' ? {} : { precondition: base }),
      view: 'full',
    });
    return toNote(memory);
  } catch (error) {
    if (isMemoryPreconditionFailure(error)) {
      throw new AppError(
        'MEMORY_EDIT_CONFLICT',
        MEMORY_EDIT_CONFLICT_MESSAGE,
        { memoryId, storeId },
        { cause: error },
      );
    }
    throw error;
  }
}

/** Rename / move — a path-only update; the memory id survives. */
export async function renameNote(
  client: Anthropic,
  storeId: string,
  memoryId: string,
  newPath: string,
): Promise<MemoryNote> {
  assertNotePath(newPath);
  try {
    const memory = await client.beta.memoryStores.memories.update(memoryId, {
      memory_store_id: storeId,
      path: newPath,
      view: 'full',
    });
    return toNote(memory);
  } catch (cause) {
    if (isMemoryPathConflict(cause))
      throw new AppError(
        'MEMORY_PATH_CONFLICT',
        'A note with that name already exists.',
        { storeId, path: newPath },
        { cause },
      );
    throw cause;
  }
}

/** Delete a note. History persists as versions (that is what the trash lists). */
export async function deleteNote(
  client: Anthropic,
  storeId: string,
  memoryId: string,
  contentSha256: string | null,
): Promise<void> {
  try {
    await client.beta.memoryStores.memories.delete(memoryId, {
      memory_store_id: storeId,
      ...(contentSha256 === null ? {} : { expected_content_sha256: contentSha256 }),
    });
  } catch (cause) {
    if (isMemoryPreconditionFailure(cause))
      throw new AppError(
        'MEMORY_EDIT_CONFLICT',
        MEMORY_EDIT_CONFLICT_MESSAGE,
        { memoryId, storeId },
        { cause },
      );
    throw cause;
  }
}
