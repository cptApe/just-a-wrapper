'use client';
import { useQueryState } from 'nuqs';
import { type ReactNode, useEffect, useState } from 'react';
import { libraryParsers } from '@/features/files/lib/library-search-params';
import type { MemorySurfaceInitial } from '../api/surface';
import { type AskAgentToUpdateMemory, useMemoryTask } from '../hooks/use-memory-task';
import { readVirtualPath } from '../lib/virtual-path';
import { MemoryBrowser } from './memory-browser';
import { MemoryPaneHeader } from './memory-pane-header';

export function MemoryPane({
  initial,
  tabToggle,
  askAgentToUpdateMemory,
  renderSearchResults,
}: {
  initial: MemorySurfaceInitial;
  tabToggle: ReactNode;
  askAgentToUpdateMemory: AskAgentToUpdateMemory;
  /** Every note matching the query, from the search feature the page composes in. */
  renderSearchResults: (query: string) => ReactNode;
}) {
  const [display, setDisplay] = useQueryState('display', libraryParsers.display);
  const [path, setPath] = useQueryState('path', libraryParsers.path);
  const [trash, setTrash] = useQueryState('trash', libraryParsers.trash);
  const [query, setQuery] = useQueryState('q', libraryParsers.q);
  const [searchInput, setSearchInput] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (searchInput.trim() !== query.trim())
        void setQuery(searchInput.trim() === '' ? null : searchInput);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, query, setQuery]);
  const { scope, storePath } = readVirtualPath(path);
  const { pending: taskPending, askAgent } = useMemoryTask(scope, askAgentToUpdateMemory);
  // Trash only applies inside a store; ignore a stale query parameter at the root.
  const inTrash = trash && scope !== null;
  // Recently deleted filters its own list; everywhere else a query searches every note.
  const searching = query.trim() !== '' && !inTrash;
  return (
    <>
      <MemoryPaneHeader
        taskPending={taskPending}
        onAskAgent={askAgent}
        initial={initial}
        scope={scope}
        storePath={storePath}
        path={path}
        inTrash={inTrash}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        navigate={(next) => setPath(next, { history: 'replace' })}
      />
      <MemoryBrowser
        taskPending={taskPending}
        initial={initial}
        tabToggle={tabToggle}
        scope={scope}
        storePath={storePath}
        inTrash={inTrash}
        layout={display === 'list' ? 'list' : 'grid'}
        trimmedQ={query.trim().toLowerCase()}
        searchResults={searching ? renderSearchResults(query) : null}
        navigate={(next) => {
          void setPath(next);
        }}
        onToggleTrash={(checked) => {
          void setTrash(checked ? true : null);
        }}
        onLayoutChange={(next) => {
          void setDisplay(next === 'grid' ? null : 'list');
        }}
      />
    </>
  );
}
