import type { DeletedMemoryNote, MemoryNote, MemoryNoteVersion } from './lib/notes';

// Server-resolved Memory view models exchanged through server actions.
// The upstream store remains the document source of truth.

/** The two stores a member sees (Foundations/Memory: two scopes = two stores). */
export type MemoryScope = 'you' | 'workspace';

export type MemoryNoteOpenMode = 'read' | 'history' | 'move';

/** Client-safe compare-before-write value captured when note editing begins. */
export type MemorySaveBase = { contentSha256: string };

export type MemorySaveResult = {
  note: MemoryNote;
  /** False only when content saved but the automatic title rename failed. */
  titleUpdated: boolean;
};

export type MemoryScopeAccess = {
  scope: MemoryScope;
  /** False while the store isn't provisioned yet (no key at provision time). */
  ready: boolean;
  /** you → always true; workspace → admins/owners only. */
  canEdit: boolean;
  /** Why writes here are refused, for disabling write controls; null when `canEdit`. */
  editRefusal: string | null;
};

/** One cursor-paginated page of note metadata. */
export type MemoryNotesPage = {
  notes: MemoryNote[];
  /** Subfolder paths directly under the listed prefix (Browse view). */
  folders: string[];
  nextCursor: string | null;
};

export type MemoryVersionsPage = {
  versions: MemoryNoteVersion[];
  nextCursor: string | null;
};

export type MemoryTrashPage = {
  notes: DeletedMemoryNote[];
  nextCursor: string | null;
};

export const MAX_MEMORY_BYTES = 100_000; // under the API's 100 kB (102,400-byte) per-memory cap
