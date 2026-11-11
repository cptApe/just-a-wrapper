'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { requireAnthropicClient } from '@/features/agents';
import { type ActionState, runAction } from '@/lib/action-state';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';
import {
  type DeletedMemoryNote,
  type MemoryNote,
  type MemoryNoteVersion,
  normalizeNoteFolder,
} from '../lib/notes';
import {
  MAX_MEMORY_BYTES,
  type MemoryNotesPage,
  type MemorySaveBase,
  type MemorySaveResult,
  type MemoryScope,
  type MemoryTrashPage,
  type MemoryVersionsPage,
} from '../types';
import { applyDerivedNoteTitle } from './apply-derived-note-title';
import { createBlankNoteAtAvailablePath } from './create-blank-note';
import { MEMORY_ACTION_FAILED_MESSAGE, memoryErrorMessage } from './memory-errors';
import { deleteNote, listNotesPage, readNote, renameNote, updateNoteContent } from './notes';
import { resolveEditableStore, resolveScopedStore } from './store-access';
import {
  listDeletedNotes,
  listNoteVersions,
  readVersionContent,
  restoreDeletedNote,
  restoreNoteVersion,
} from './versions';

const memorySaveBaseSchema = z.strictObject({
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const providerId = z.string().min(1).max(256);

// Every argument an action can take; each action parses the ones it was given.
const memoryArgs = z
  .object({
    scope: z.enum(['you', 'workspace']),
    memoryId: providerId,
    versionId: providerId,
    folderPath: z.string().max(4096),
    newPath: z.string().max(4096),
    cursor: z.string().max(4096).nullable(),
    content: z.string(),
    base: memorySaveBaseSchema,
    deleteBase: z.union([memorySaveBaseSchema, z.literal('unguarded-delete')]),
    deleted: z.object({ memoryId: providerId, tombstoneVersionId: providerId }),
  })
  .partial()
  .strict();

// Resolve store IDs from the signed-in scope and enforce write access in every action.
function memoryAction<T>(
  route: string,
  args: z.input<typeof memoryArgs>,
  action: () => Promise<T>,
): Promise<ActionState<T>> {
  return runAction(
    {
      route,
      feature: 'memory',
      message: MEMORY_ACTION_FAILED_MESSAGE,
      appErrorMessage: memoryErrorMessage,
    },
    async () => {
      const parsed = memoryArgs.safeParse(args);
      if (!parsed.success) {
        throw new AppError('TOOL_INPUT_INVALID', 'This memory request is not valid.', {
          issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
      }
      return action();
    },
  );
}

function validateContent(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_BYTES) {
    throw new AppError('TOOL_INPUT_INVALID', 'this note is too large to save (max 100 kB)', {
      max: MAX_MEMORY_BYTES,
    });
  }
}

// Reads

/** One Browse page: the notes + subfolders directly inside a folder. */
export async function loadMemoryBrowsePage(
  scope: MemoryScope,
  folderPath: string,
  cursor: string | null,
): Promise<ActionState<MemoryNotesPage>> {
  return memoryAction('memory/browse-page', { scope, folderPath, cursor }, async () => {
    const scoped = await resolveScopedStore(await headers(), scope);
    const client = requireAnthropicClient();
    return listNotesPage(client, scoped.storeId, {
      cursor,
      pathPrefix: folderPath === '/' ? '/' : `${folderPath}/`,
      depth: 1,
    });
  });
}

// Hash links load their own note; opening the overlay does not require a warm list cache.
export async function loadMemoryNote(
  scope: MemoryScope,
  memoryId: string,
): Promise<ActionState<{ note: MemoryNote; canEdit: boolean }>> {
  return memoryAction('memory/note', { scope, memoryId }, async () => {
    const scoped = await resolveScopedStore(await headers(), scope);
    const client = requireAnthropicClient();
    return { note: await readNote(client, scoped.storeId, memoryId), canEdit: scoped.canEdit };
  });
}

// Note CRUD (1:1 to the API)

/** Create immediately with the Untitled name. */
export async function createBlankMemoryNote(
  scope: MemoryScope,
  folderPath: string,
): Promise<ActionState<MemoryNote>> {
  return memoryAction('memory/create-blank-note', { scope, folderPath }, async () => {
    const normalizedFolder = normalizeNoteFolder(folderPath);
    if (normalizedFolder === null) {
      throw new AppError('TOOL_INPUT_INVALID', 'memory note folder failed validation', {
        folderPath,
      });
    }
    const scoped = await resolveEditableStore(await headers(), scope);
    const client = requireAnthropicClient();
    const note = await createBlankNoteAtAvailablePath(client, scoped.storeId, normalizedFolder);
    // Captured here, not inside createNote: the path-conflict retry above may
    // call create twice for one note.
    captureEvent(
      'memory:note_create',
      { memory_scope: scope, note_id: note.id },
      {
        userId: scoped.ctx.userId,
        workspaceId: await workspaceIdForOrganization(scoped.ctx.organizationId),
      },
    );
    return note;
  });
}

export async function saveMemoryNote(
  scope: MemoryScope,
  memoryId: string,
  content: string,
  /** The content SHA captured when the editor loaded the note. */
  base: MemorySaveBase,
): Promise<ActionState<MemorySaveResult>> {
  return memoryAction('memory/save-note', { scope, memoryId, content, base }, async () => {
    const scoped = await resolveEditableStore(await headers(), scope);
    validateContent(content);
    const client = requireAnthropicClient();
    const saved = await updateNoteContent(client, scoped.storeId, memoryId, content, {
      type: 'content_sha256',
      content_sha256: base.contentSha256,
    });
    return applyDerivedNoteTitle(client, scoped.storeId, saved, content);
  });
}

export async function renameMemoryNote(
  scope: MemoryScope,
  memoryId: string,
  newPath: string,
): Promise<ActionState<MemoryNote>> {
  return memoryAction('memory/rename-note', { scope, memoryId, newPath }, async () => {
    const scoped = await resolveEditableStore(await headers(), scope);
    const client = requireAnthropicClient();
    return renameNote(client, scoped.storeId, memoryId, newPath);
  });
}

export async function deleteMemoryNote(
  scope: MemoryScope,
  memoryId: string,
  base: MemorySaveBase | 'unguarded-delete',
): Promise<ActionState<undefined>> {
  return memoryAction('memory/delete-note', { scope, memoryId, deleteBase: base }, async () => {
    const scoped = await resolveEditableStore(await headers(), scope);
    const client = requireAnthropicClient();
    await deleteNote(
      client,
      scoped.storeId,
      memoryId,
      base === 'unguarded-delete' ? null : base.contentSha256,
    );
    return undefined;
  });
}

// History + trash (Foundations/Memory: recovery)

export async function loadMemoryNoteVersions(
  scope: MemoryScope,
  memoryId: string,
  cursor: string | null,
): Promise<ActionState<MemoryVersionsPage>> {
  return memoryAction('memory/versions', { scope, memoryId, cursor }, async () => {
    const scoped = await resolveScopedStore(await headers(), scope);
    const client = requireAnthropicClient();
    return listNoteVersions(client, scoped.storeId, memoryId, cursor);
  });
}

export async function previewMemoryNoteVersion(
  scope: MemoryScope,
  versionId: string,
): Promise<ActionState<{ content: string | null; version: MemoryNoteVersion }>> {
  return memoryAction('memory/version-preview', { scope, versionId }, async () => {
    const scoped = await resolveScopedStore(await headers(), scope);
    const client = requireAnthropicClient();
    return readVersionContent(client, scoped.storeId, versionId);
  });
}

export async function restoreMemoryNoteVersion(
  scope: MemoryScope,
  memoryId: string,
  versionId: string,
  base: MemorySaveBase,
): Promise<ActionState<MemoryNote>> {
  return memoryAction('memory/restore-version', { scope, memoryId, versionId, base }, async () => {
    const scoped = await resolveEditableStore(await headers(), scope);
    const client = requireAnthropicClient();
    return restoreNoteVersion(client, scoped.storeId, memoryId, versionId, base.contentSha256);
  });
}

export async function loadMemoryTrash(
  scope: MemoryScope,
  cursor: string | null,
): Promise<ActionState<MemoryTrashPage>> {
  return memoryAction('memory/trash', { scope, cursor }, async () => {
    const scoped = await resolveScopedStore(await headers(), scope);
    const client = requireAnthropicClient();
    return listDeletedNotes(client, scoped.storeId, cursor);
  });
}

export async function restoreDeletedMemoryNote(
  scope: MemoryScope,
  deleted: Pick<DeletedMemoryNote, 'memoryId' | 'tombstoneVersionId'>,
): Promise<ActionState<MemoryNote>> {
  return memoryAction('memory/restore-deleted', { scope, deleted }, async () => {
    const scoped = await resolveEditableStore(await headers(), scope);
    const client = requireAnthropicClient();
    return restoreDeletedNote(client, scoped.storeId, deleted);
  });
}
