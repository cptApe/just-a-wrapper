'use client';

import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import {
  type MemoryBrowseCache,
  patchNoteRow,
  removeNoteRow,
  unwrapMemoryResult,
} from '../lib/memory-cache';
import { type MemoryNote, noteParentPath } from '../lib/notes';
import type { MemorySaveBase, MemoryScope } from '../types';
import { deleteMemoryNote, renameMemoryNote, saveMemoryNote } from './actions';
import { memoryQueryKeys } from './keys';
import type { MemoryNoteData } from './use-memory-note';

type MemoryMutationCache = {
  queryClient: QueryClient;
  organizationKey: string;
  root: readonly unknown[];
};

type RemoveVariables = { scope: MemoryScope; note: MemoryNote; intent: 'delete' | 'discard' };
type RemoveManyVariables = { scope: MemoryScope; ids: string[] };
type RenameVariables = { scope: MemoryScope; note: MemoryNote; newPath: string; moved: boolean };

export type SaveVariables = {
  scope: MemoryScope;
  note: MemoryNote;
  content: string;
  base: MemorySaveBase;
};

function descriptionOf(error: unknown): string | undefined {
  return error instanceof AppError ? error.message : undefined;
}

// Edits show at once and roll back on failure. The editor holds its draft until the save settles,
// so a later edit starts from the saved SHA. Do not invalidate Files: it uses a different store and only shares browser components.
function useMemoryMutationCache(organizationId: string | null): MemoryMutationCache {
  const queryClient = useQueryClient();
  const organizationKey = organizationId ?? 'unscoped';
  return { queryClient, organizationKey, root: memoryQueryKeys.all(organizationKey) };
}

function useMemorySaveMutation(cache: MemoryMutationCache) {
  const { queryClient, organizationKey, root } = cache;
  return useMutation({
    mutationFn: (vars: SaveVariables) =>
      saveMemoryNote(vars.scope, vars.note.id, vars.content, vars.base).then(unwrapMemoryResult),
    ...optimisticMutation(queryClient, {
      root,
      apply: (vars: SaveVariables) => {
        const sizeBytes = new TextEncoder().encode(vars.content).length;
        queryClient.setQueryData<MemoryNoteData>(
          memoryQueryKeys.note(organizationKey, vars.scope, vars.note.id),
          (old) =>
            old ? { ...old, note: { ...old.note, content: vars.content, sizeBytes } } : old,
        );
        queryClient.setQueryData<MemoryBrowseCache>(
          memoryQueryKeys.browse(organizationKey, vars.scope, noteParentPath(vars.note.path)),
          (old) => patchNoteRow(old, vars.note.id, { sizeBytes }),
        );
      },
      // The editor displays a conflict banner; only other failures need a toast.
      failure: (error, vars) =>
        error instanceof AppError && error.code === 'MEMORY_EDIT_CONFLICT'
          ? null
          : {
              message: 'Couldn’t save the note',
              description: descriptionOf(error),
              capture: { op: 'memory-save-note', memoryId: vars.note.id },
            },
    }),
    onSuccess: (result, vars) => {
      const saved = result.note;
      queryClient.setQueryData<MemoryNoteData>(
        memoryQueryKeys.note(organizationKey, vars.scope, vars.note.id),
        (old) => (old ? { ...old, note: saved } : old),
      );
      queryClient.setQueryData<MemoryBrowseCache>(
        memoryQueryKeys.browse(organizationKey, vars.scope, noteParentPath(vars.note.path)),
        (old) =>
          patchNoteRow(old, vars.note.id, {
            contentSha256: saved.contentSha256,
            path: saved.path,
            sizeBytes: saved.sizeBytes,
            updatedAt: saved.updatedAt,
          }),
      );
      if (result.titleUpdated) toast.success('Note saved');
      else
        toast.warning('Note saved, but its title couldn’t update', {
          description:
            'It’s still called Untitled. Rename it, or open the editor and save again to retry.',
        });
    },
  });
}

function useMemoryRemoveMutation(cache: MemoryMutationCache) {
  const { queryClient, organizationKey, root } = cache;
  return useMutation({
    mutationFn: (vars: RemoveVariables) =>
      deleteMemoryNote(vars.scope, vars.note.id, { contentSha256: vars.note.contentSha256 }).then(
        unwrapMemoryResult,
      ),
    ...optimisticMutation(queryClient, {
      root,
      apply: (vars: RemoveVariables) =>
        void queryClient.setQueryData<MemoryBrowseCache>(
          memoryQueryKeys.browse(organizationKey, vars.scope, noteParentPath(vars.note.path)),
          (old) => removeNoteRow(old, vars.note.id),
        ),
      failure: (error, vars) => ({
        message: 'Couldn’t delete the note',
        description: descriptionOf(error),
        capture: { op: 'memory-delete-note', memoryId: vars.note.id },
      }),
    }),
    onSuccess: (_result, vars) => {
      if (vars.intent === 'delete') toast.success('Note moved to Recently deleted');
    },
  });
}

// Selected rows leave every loaded list at once; the settling invalidate restores any partial failure.
function useMemoryRemoveManyMutation(cache: MemoryMutationCache) {
  const { queryClient, organizationKey, root } = cache;
  return useMutation({
    mutationFn: async (vars: RemoveManyVariables) => {
      const results = await Promise.all(
        vars.ids.map((id) => deleteMemoryNote(vars.scope, id, 'unguarded-delete')),
      );
      for (const result of results) unwrapMemoryResult(result);
    },
    ...optimisticMutation(queryClient, {
      root,
      apply: (vars: RemoveManyVariables) =>
        void queryClient.setQueriesData<MemoryBrowseCache>(
          { queryKey: memoryQueryKeys.browseScope(organizationKey, vars.scope) },
          (old) => vars.ids.reduce((next, id) => removeNoteRow(next, id), old),
        ),
      failure: (error, vars) => ({
        message: 'Couldn’t delete some notes',
        description: descriptionOf(error),
        capture: { op: 'memory-delete-selected-notes', count: vars.ids.length },
      }),
    }),
    onSuccess: (_result, vars) => {
      toast.success(
        vars.ids.length === 1
          ? 'Note moved to Recently deleted'
          : `${vars.ids.length} notes moved to Recently deleted`,
      );
    },
  });
}

function useMemoryRenameMutation(cache: MemoryMutationCache) {
  const { queryClient, organizationKey, root } = cache;
  return useMutation({
    mutationFn: (vars: RenameVariables) =>
      renameMemoryNote(vars.scope, vars.note.id, vars.newPath).then(unwrapMemoryResult),
    ...optimisticMutation(queryClient, {
      root,
      apply: (vars: RenameVariables) => {
        queryClient.setQueryData<MemoryNoteData>(
          memoryQueryKeys.note(organizationKey, vars.scope, vars.note.id),
          (old) => (old ? { ...old, note: { ...old.note, path: vars.newPath } } : old),
        );
        // A row that changes folders leaves this list; the settling invalidate places it.
        const parent = noteParentPath(vars.note.path);
        queryClient.setQueryData<MemoryBrowseCache>(
          memoryQueryKeys.browse(organizationKey, vars.scope, parent),
          (old) =>
            noteParentPath(vars.newPath) === parent
              ? patchNoteRow(old, vars.note.id, { path: vars.newPath })
              : removeNoteRow(old, vars.note.id),
        );
      },
      failure: (error, vars) => ({
        message: vars.moved ? 'Couldn’t move the note' : 'Couldn’t rename the note',
        description: descriptionOf(error),
        capture: { op: 'memory-rename-note', memoryId: vars.note.id },
      }),
    }),
    onSuccess: (_result, vars) => toast.success(vars.moved ? 'Note moved' : 'Note renamed'),
  });
}

export function useMemoryNoteMutations(organizationId: string | null) {
  const cache = useMemoryMutationCache(organizationId);
  const saveMutation = useMemorySaveMutation(cache);
  const removeMutation = useMemoryRemoveMutation(cache);
  const removeManyMutation = useMemoryRemoveManyMutation(cache);
  const renameMutation = useMemoryRenameMutation(cache);
  return {
    actions: {
      save: saveMutation.mutate,
      remove: removeMutation.mutate,
      removeMany: removeManyMutation.mutate,
      rename: renameMutation.mutate,
    },
    pending: {
      remove: removeMutation.isPending,
      removeMany: removeManyMutation.isPending,
      rename: renameMutation.isPending,
    },
  };
}
