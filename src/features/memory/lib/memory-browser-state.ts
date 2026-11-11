import type { DeletedMemoryNote, MemoryNote } from './notes';

type BrowseEntry = {
  kind: 'browse';
  status: 'ready' | 'error';
  notes: MemoryNote[];
  folders: string[];
  hasMore: boolean;
  loadingMore: boolean;
};
type TrashEntry = {
  kind: 'trash';
  status: 'ready' | 'error';
  items: DeletedMemoryNote[];
  hasMore: boolean;
  loadingMore: boolean;
};
export type MemoryListView = BrowseEntry | TrashEntry;

type PageState = {
  isError: boolean;
  hasData: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
};

export function memoryBrowserState(
  browse: PageState & { notes: MemoryNote[]; folders: string[] },
  trash: PageState & { items: DeletedMemoryNote[] },
  view: { atRoot: boolean; inTrash: boolean },
): MemoryListView | { kind: 'loading' } | null {
  const { atRoot, inTrash } = view;
  const { notes: browseNotes, folders: browseFolders } = browse;
  const { items: trashItems } = trash;
  if (atRoot) return null;
  if (inTrash) {
    if (trash.isError) {
      return { kind: 'trash', status: 'error', items: [], hasMore: false, loadingMore: false };
    }
    if (!trash.hasData) return { kind: 'loading' };
    return {
      kind: 'trash',
      status: 'ready',
      items: trashItems,
      hasMore: trash.hasNextPage,
      loadingMore: trash.isFetchingNextPage,
    };
  }
  if (browse.isError) {
    return {
      kind: 'browse',
      status: 'error',
      notes: [],
      folders: [],
      hasMore: false,
      loadingMore: false,
    };
  }
  if (!browse.hasData) return { kind: 'loading' };
  return {
    kind: 'browse',
    status: 'ready',
    notes: browseNotes,
    folders: browseFolders,
    hasMore: browse.hasNextPage,
    loadingMore: browse.isFetchingNextPage,
  };
}
