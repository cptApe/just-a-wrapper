import type Anthropic from '@anthropic-ai/sdk';
import { captureException } from '@/lib/observability';
import {
  derivedNoteFilename,
  type MemoryNote,
  noteBasename,
  noteParentPath,
  uniqueNotePath,
} from '../lib/notes';
import { listSiblingNotePaths } from './create-blank-note';
import { renameNote } from './notes';

function timestampFilename(filename: string, timestamp: number): string {
  const lastDot = filename.lastIndexOf('.');
  const extensionIndex = lastDot > 0 ? lastDot : filename.length;
  return `${filename.slice(0, extensionIndex)} (${timestamp})${filename.slice(extensionIndex)}`;
}

// Preserve the saved content and its SHA if automatic naming fails. The UI offers rename again.
export async function applyDerivedNoteTitle(
  client: Anthropic,
  storeId: string,
  saved: MemoryNote,
  content: string,
): Promise<{ note: MemoryNote; titleUpdated: boolean }> {
  const basename = noteBasename(saved.path);
  if (!/^Untitled(?: \(\d+\))?\.(?:md|txt)$/i.test(basename)) {
    return { note: saved, titleUpdated: true };
  }

  const folderPath = noteParentPath(saved.path);
  const filename = derivedNoteFilename(content, basename.slice(basename.lastIndexOf('.')));
  const directDerivedPath = uniqueNotePath(folderPath, filename, [], saved.path);
  if (directDerivedPath === saved.path) return { note: saved, titleUpdated: true };

  try {
    const { paths: siblings, hitPageCap } = await listSiblingNotePaths(client, storeId, folderPath);
    const availableFilename = hitPageCap ? timestampFilename(filename, Date.now()) : filename;
    const derivedPath = uniqueNotePath(folderPath, availableFilename, siblings, saved.path);
    const note =
      derivedPath === saved.path ? saved : await renameNote(client, storeId, saved.id, derivedPath);
    return { note, titleUpdated: true };
  } catch (error) {
    // The caller must retain the committed note's fresh SHA. Treating this
    // as a failed content save would make the next retry conflict with itself.
    captureException(error, { op: 'memory/derive-note-title', memoryId: saved.id });
    return { note: saved, titleUpdated: false };
  }
}
