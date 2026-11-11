'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability-client';
import { createBlankMemoryNote } from '../api/actions';
import { memoryQueryKeys } from '../api/keys';
import type { MemorySurfaceInitial } from '../api/surface';
import type { MemoryNoteData } from '../api/use-memory-note';
import { NOTE_ROOT } from '../lib/notes';
import { toVirtualPath } from '../lib/virtual-path';
import type { MemoryScope } from '../types';

export function useCreateMemoryNote({
  initial,
  scope,
  storePath,
  inTrash,
  path,
  navigate,
}: {
  initial: MemorySurfaceInitial;
  scope: MemoryScope | null;
  storePath: string;
  inTrash: boolean;
  path: string;
  navigate: (path: string) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId() ?? 'unscoped';
  const creation = useMutation({
    mutationFn: async (target: { scope: MemoryScope; path: string }) => {
      const response = await createBlankMemoryNote(target.scope, target.path);
      if (!response.ok) throw new AppError(response.code, response.message, {});
      return response.data;
    },
  });
  const creatingNote = creation.isPending;
  // Creation at the two-store root or in a read-only workspace defaults to personal memory.
  const canCreateNote = initial.access.you.ready && initial.access.you.canEdit && !inTrash;
  function createNoteAtCurrentLocation() {
    if (creatingNote || inTrash) return;
    const targetScope = scope !== null && initial.access[scope].canEdit ? scope : 'you';
    const targetPath = targetScope === scope ? storePath : NOTE_ROOT;
    void (async () => {
      try {
        const created = await creation.mutateAsync({ scope: targetScope, path: targetPath });
        queryClient.setQueryData<MemoryNoteData>(
          memoryQueryKeys.note(organizationId, targetScope, created.id),
          { note: created, canEdit: true },
        );
        void queryClient.invalidateQueries({ queryKey: memoryQueryKeys.list(organizationId) });
        openOverlay(buildOverlayHash('memory', created.id, { scope: targetScope, edit: '1' }));
        const targetVirtualPath = toVirtualPath(targetScope, targetPath);
        if (targetVirtualPath !== path) {
          try {
            await navigate(targetVirtualPath);
          } catch (error) {
            captureException(error, { op: 'memory-create-navigation' });
            toast.error('Note created, but the folder couldn’t open.');
          }
        }
      } catch (error) {
        captureException(error, { op: 'memory-create-note' });
        toast.error('Couldn’t create the note', { description: 'Please try again.' });
      }
    })();
  }

  return { creatingNote, canCreateNote, createNoteAtCurrentLocation };
}
