import type { InfiniteData } from '@tanstack/react-query';
import type { ActionState } from '@/lib/action-state';
import { AppError } from '@/lib/errors';
import type { MemoryNotesPage } from '../types';
import type { MemoryNote } from './notes';

export const FIRST_PAGE: string | null = null;

export type MemoryBrowseCache = InfiniteData<MemoryNotesPage, string | null>;

// Server actions serialize failures; React Query needs throws to run rollback and error handling.
export function unwrapMemoryResult<T>(res: ActionState<T>): T {
  if (!res.ok) {
    throw new AppError(res.code, res.message);
  }
  return res.data;
}

export function removeNoteRow(
  cache: MemoryBrowseCache | undefined,
  id: string,
): MemoryBrowseCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      notes: page.notes.filter((note) => note.id !== id),
    })),
  };
}

/** Patch the note with `id` wherever it sits across the loaded Browse pages. */
export function patchNoteRow(
  cache: MemoryBrowseCache | undefined,
  id: string,
  patch: Partial<MemoryNote>,
): MemoryBrowseCache | undefined {
  if (!cache) return cache;
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      notes: page.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    })),
  };
}
