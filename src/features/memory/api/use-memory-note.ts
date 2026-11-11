'use client';

import { useQuery } from '@tanstack/react-query';
import { AppError } from '@/lib/errors';
import { unwrapMemoryResult } from '../lib/memory-cache';
import type { MemoryNote } from '../lib/notes';
import type { MemoryScope } from '../types';
import { loadMemoryNote } from './actions';
import { memoryQueryKeys } from './keys';

export type MemoryNoteData = { note: MemoryNote; canEdit: boolean };

// The cache outlives the overlay. A null workspace uses the same unscoped key as the pane;
// the server still resolves authorization from the session, never from this cache key.
export function useMemoryNote(args: {
  organizationId: string | null;
  scope: MemoryScope;
  id: string | null;
}) {
  const { organizationId, scope, id } = args;
  return useQuery<MemoryNoteData>({
    queryKey: memoryQueryKeys.note(organizationId ?? 'unscoped', scope, id ?? 'none'),
    queryFn: async () => {
      if (id === null) throw new AppError('UNEXPECTED', 'Memory note id is missing.');
      return unwrapMemoryResult(await loadMemoryNote(scope, id));
    },
    enabled: id !== null,
  });
}
