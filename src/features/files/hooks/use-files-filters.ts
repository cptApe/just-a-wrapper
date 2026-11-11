import { useQueryState } from 'nuqs';
import * as React from 'react';
import type { TypeFacet } from '../lib/file-types';
import { filesViewState } from '../lib/files-view-machine';
import {
  DEFAULT_SORT,
  filesQueryKey,
  fileViewFrom,
  type LibraryFilesQuery,
  type SortSpec,
} from '../lib/library-items';
import { libraryParsers } from '../lib/library-search-params';

/** What the Files pane shows, read from the URL, and the moves that change it. */
export function useFilesFilters() {
  const [view, setView] = useQueryState('view', libraryParsers.view);
  const [path, setPath] = useQueryState('path', libraryParsers.path);
  const [sortKey, setSortKey] = useQueryState('sort', libraryParsers.sort);
  const [sortDir, setSortDir] = useQueryState('dir', libraryParsers.dir);
  const [rawType, setType] = useQueryState('type', libraryParsers.type);
  const [trash, setTrash] = useQueryState('trash', libraryParsers.trash);
  const [q, setQ] = useQueryState('q', libraryParsers.q);
  const navigation = filesViewState({ trash, type: rawType, q, path });
  const type = navigation.kind === 'filtered' ? navigation.facet : null;
  const sort: SortSpec = { key: sortKey, dir: sortDir };
  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(timer);
  }, [q]);

  const query: Omit<LibraryFilesQuery, 'offset'> = {
    path,
    type,
    q: q === '' ? '' : debouncedQ.trim(),
    trash,
    sort: sortKey,
    dir: sortDir,
  };

  return {
    path,
    trash,
    type,
    sort,
    fileView: fileViewFrom(view),
    searchInput: q,
    trimmedQ: q.trim(),
    browsing: navigation.kind === 'folder',
    query,
    queryKey: filesQueryKey(query),
    search: (value: string) => void setQ(value),
    /** Opens a folder and clears the search, since a search lists files from every folder. */
    openPath: (next: string | null) => {
      void setPath(next);
      void setQ(null);
    },
    /** A type facet and Recently deleted are separate views, so choosing one leaves the other. */
    chooseType: (facet: TypeFacet | null) => {
      void setType(facet);
      void setTrash(null);
    },
    showDeleted: (on: boolean) => {
      void setTrash(on ? true : null);
      if (on) void setType(null);
    },
    showGrid: () => void setView(null),
    showList: () => void setView('list'),
    changeSort: (next: SortSpec) => {
      void setSortKey(next.key === DEFAULT_SORT.key ? null : next.key);
      void setSortDir(next.dir === DEFAULT_SORT.dir ? null : next.dir);
    },
  };
}
