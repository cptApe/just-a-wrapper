'use client';

import { useQueryStates } from 'nuqs';
import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { askAgentToUpdateMemory } from '@/features/chat/api/memory-update-actions';
import { newTaskWithFiles } from '@/features/chat/api/new-task-with-files';
import type { FolderEntry, LibraryFilesPage, LibraryTab, UploadConfig } from '@/features/files';
import { FilesPane } from '@/features/files/components/files-pane';
import { libraryParsers } from '@/features/files/lib/library-search-params';
import type { MemorySurfaceInitial } from '@/features/memory';
import { MemoryPane } from '@/features/memory/components/memory-pane';
import { MemorySearchResults } from '@/features/search/components/memory-search-results';

// Library switches between Files and Memory through shallow tab query state.
// Panes own headers so selection can replace the toggle in place.
// Import client components directly, keeping server API barrels out of the island.

const TAB_OPTIONS = [
  { value: 'files' as const, label: 'Files' },
  { value: 'memory' as const, label: 'Memory' },
];

export function LibraryIsland({
  files,
  memory,
}: {
  files: {
    organizationId: string;
    workspaceId: string;
    folders: FolderEntry[];
    folderCounts: Record<string, number>;
    initialPage: LibraryFilesPage;
    initialQueryKey: string;
    uploadConfig: UploadConfig;
    canAdministerWorkspace: boolean;
    editableFolderPaths: string[];
    showTeamFolder: boolean;
  };
  memory: MemorySurfaceInitial;
}) {
  const [{ tab }, setParams] = useQueryStates(libraryParsers);
  function changeTab(next: LibraryTab) {
    if (next === tab) return;
    void setParams({
      tab: next,
      q: null,
      path: null,
      trash: null,
      view: null,
      display: null,
      scope: null,
      sort: null,
      dir: null,
      type: null,
    });
  }

  const tabToggle = (
    <Segmented
      value={tab}
      options={TAB_OPTIONS}
      onChange={(next) => next && changeTab(next)}
      label="Library surface"
    />
  );

  return tab === 'memory' ? (
    <MemoryPane
      initial={memory}
      tabToggle={tabToggle}
      askAgentToUpdateMemory={askAgentToUpdateMemory}
      renderSearchResults={(query) => <MemorySearchResults query={query} />}
    />
  ) : (
    <FilesPane
      organizationId={files.organizationId}
      workspaceId={files.workspaceId}
      folders={files.folders}
      folderCounts={files.folderCounts}
      initialPage={files.initialPage}
      initialQueryKey={files.initialQueryKey}
      uploadConfig={files.uploadConfig}
      canAdministerWorkspace={files.canAdministerWorkspace}
      editableFolderPaths={files.editableFolderPaths}
      showTeamFolder={files.showTeamFolder}
      tabToggle={tabToggle}
      newTaskWithFiles={newTaskWithFiles}
    />
  );
}
