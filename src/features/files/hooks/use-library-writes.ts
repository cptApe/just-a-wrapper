'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { AppError } from '@/lib/errors';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { fileQueryKeys } from '../api/keys';
import {
  editLibraryCache,
  type FileEdit,
  type FolderEdit,
  type LibraryCache,
} from '../lib/library-cache';
import type { ActionResult, FolderEntry } from '../types';

type LibraryWrite = {
  action: () => Promise<ActionResult<unknown>>;
  success: string;
  failure: string;
  files?: FileEdit;
  folders?: FolderEdit;
  /** A restored trash folder leaves the Recently deleted list. */
  deletedFolderId?: string;
  /** Local follow-up that happens with the write, such as leaving a folder being deleted. */
  after?: () => void;
};

export type RunLibraryWrite = (write: LibraryWrite) => void;

// File rows change in React Query. Folders are server props, so they change through useOptimistic,
// which holds the edit until the transition's refresh delivers new props.
export function useLibraryWrites({
  organizationId,
  folders,
  refreshLibrary,
  startTransition,
}: {
  organizationId: string;
  folders: FolderEntry[];
  refreshLibrary: () => void;
  startTransition: React.TransitionStartFunction;
}) {
  const queryClient = useQueryClient();
  const [optimisticFolders, applyFolderEdit] = React.useOptimistic(
    folders,
    (current: FolderEntry[], edit: FolderEdit) => edit(current),
  );
  const { mutate } = useMutation({
    mutationFn: async ({ action }: LibraryWrite) => {
      const result = await action();
      if (!result.ok) throw new AppError(result.code, result.message);
    },
    ...optimisticMutation(queryClient, {
      root: fileQueryKeys.all(organizationId),
      apply: ({ files, deletedFolderId }: LibraryWrite) =>
        void queryClient.setQueriesData<LibraryCache>(
          { queryKey: fileQueryKeys.lists(organizationId) },
          (old) => editLibraryCache(old, { files, deletedFolderId }),
        ),
      failure: (error, { failure }) => ({ message: failure, description: error.message }),
      settle: refreshLibrary,
    }),
    onSuccess: (_result, { success }) => {
      toast.success(success);
    },
  });

  const run: RunLibraryWrite = (write) => {
    startTransition(async () => {
      if (write.folders) applyFolderEdit(write.folders);
      write.after?.();
      await new Promise<void>((resolve) => {
        mutate(write, { onSettled: () => resolve() });
      });
    });
  };

  return { folders: optimisticFolders, run };
}
