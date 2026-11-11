import type Anthropic from '@anthropic-ai/sdk';
import { AppError } from '@/lib/errors';
import { type MemoryNote, uniqueNotePath } from '../lib/notes';
import { createNote, listNotesPage } from './notes';

const MAX_SIBLING_PAGES = 10;

export async function listSiblingNotePaths(
  client: Anthropic,
  storeId: string,
  folderPath: string,
): Promise<{ paths: string[]; hitPageCap: boolean }> {
  const paths: string[] = [];
  let cursor: string | null = null;
  const seenCursors = new Set<string>();

  for (let pageNumber = 0; pageNumber < MAX_SIBLING_PAGES; pageNumber += 1) {
    const page = await listNotesPage(client, storeId, {
      cursor,
      pathPrefix: folderPath === '/' ? '/' : `${folderPath}/`,
      depth: 1,
    });
    paths.push(...page.notes.map((note) => note.path));
    if (page.nextCursor === null) return { paths, hitPageCap: false };
    if (seenCursors.has(page.nextCursor)) {
      throw new AppError('EXTERNAL_API_FAILED', 'Memory returned a repeated page cursor.', {
        cursor: page.nextCursor,
        folderPath,
      });
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return { paths, hitPageCap: true };
}

// A racing creator can claim a path after listing; retry that conflict once with the next suffix.
export async function createBlankNoteAtAvailablePath(
  client: Anthropic,
  storeId: string,
  folderPath: string,
): Promise<MemoryNote> {
  const { paths, hitPageCap } = await listSiblingNotePaths(client, storeId, folderPath);

  const baseFilename = hitPageCap ? `Untitled (${Date.now()}).md` : 'Untitled.md';
  const firstPath = uniqueNotePath(folderPath, baseFilename, paths, null);

  try {
    return await createNote(client, storeId, firstPath, '');
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'MEMORY_PATH_CONFLICT') throw error;
    const retryPath = uniqueNotePath(folderPath, baseFilename, [...paths, firstPath], null);
    return createNote(client, storeId, retryPath, '');
  }
}
