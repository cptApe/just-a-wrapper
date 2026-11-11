'use client';
import { PageHeader } from '@/components/layouts/page-shell';
import { SearchField } from '@/components/ui/search-field';
import { MemoryEditMenu } from '@/features/files/browser';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import type { MemorySurfaceInitial } from '../api/surface';
import { useCreateMemoryNote } from '../hooks/use-create-memory-note';
import type { MemoryScope } from '../types';
export function MemoryPaneHeader({
  taskPending,
  onAskAgent,
  initial,
  scope,
  storePath,
  path,
  inTrash,
  navigate,
  searchInput,
  onSearchChange,
}: {
  taskPending: boolean;
  onAskAgent: () => void;
  initial: MemorySurfaceInitial;
  scope: MemoryScope | null;
  storePath: string;
  path: string;
  inTrash: boolean;
  navigate: (path: string) => Promise<unknown>;
  searchInput: string;
  onSearchChange: (value: string) => void;
}) {
  const { creatingNote, canCreateNote, createNoteAtCurrentLocation } = useCreateMemoryNote({
    initial,
    scope,
    storePath,
    path,
    inTrash,
    navigate,
  });
  return (
    <PageHeader
      title="Library"
      action={
        <>
          <SearchField value={searchInput} onChange={onSearchChange} placeholder="Search memory" />
          <MemoryEditMenu
            onCreateNote={createNoteAtCurrentLocation}
            onAskAgent={onAskAgent}
            askingAgent={taskPending}
            askDisabledReason={initial.access[scope ?? 'you'].editRefusal}
            canCreateNote={canCreateNote}
            creatingNote={creatingNote}
            createDisabledReason={
              inTrash ? 'Leave Recently deleted to create a note' : CAPABILITY_OFF_MESSAGES.memory
            }
          />
        </>
      }
    />
  );
}
