'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { IconFolder, IconFolderX } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import {
  BrowserBreadcrumbs,
  BrowserGrid,
  type BrowserItem,
  BrowserSkeletons,
  useBrowserSelection,
} from '@/features/files/browser';
import { fileGlyphTone, fileKindGlyph } from '@/features/files/components/file-kind-icon';
import { displayFilename, fileExtensionBadge } from '@/features/files/lib/file-types';
import { ROOT } from '@/features/files/lib/paths';
import type { ComposerLibraryFile, ComposerLibraryFolder } from '@/features/sessions/types';
import { formatBytes } from '@/lib/format/format-bytes';
import { plural } from '@/lib/format/plural';
import { chatQueryKeys } from '../api/keys';
import { type ComposerLibraryListing, loadComposerLibrary } from '../api/library-picker';
import { PickerEmpty, PickerError } from './composer-picker-states';

// The "Add from library" body of the shared attach canvas (one Modal
// instance in ComposerAttachCanvas — this renders its header/content/footer, not
// its own overlay). Full parity with the Library page browser: it reuses that
// page's exact machinery (useBrowserSelection + BrowserGrid + SelectionCheckbox
// + BrowserBreadcrumbs) — folders and files render together, folders drill in
// (double-click / breadcrumb back), and BOTH are selectable. Confirm attaches
// the picks to the composer — files by ref, folders by path reference (the same
// product rule as New-task-with-folder).

const FILE_PREFIX = 'file:';
const FOLDER_PREFIX = 'folder:';
const noopContextMenu = () => {};

function fileItem(file: ComposerLibraryFile): BrowserItem {
  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');
  return {
    key: `${FILE_PREFIX}${file.id}`,
    kind: 'doc',
    name: displayFilename(file.name),
    renameName: file.name,
    caption: formatBytes(file.sizeBytes),
    modifiedAt: null,
    sizeBytes: file.sizeBytes,
    kindLabel: fileExtensionBadge(file.mimeType, file.name),
    imageSrc: isImage ? file.url : null,
    videoSrc: isVideo ? file.url : null,
    playBadge: isVideo,
    glyph: fileKindGlyph(file.mimeType, file.name),
    glyphTone: fileGlyphTone(file.mimeType, file.name),
    selectable: true,
    menu: [],
  };
}

function folderItem(folder: ComposerLibraryFolder): BrowserItem {
  return {
    key: `${FOLDER_PREFIX}${folder.path}`,
    kind: 'folder',
    name: folder.name,
    caption: plural(folder.itemCount, 'item'),
    modifiedAt: null,
    sizeBytes: null,
    kindLabel: 'Folder',
    imageSrc: null,
    glyph: IconFolder,
    selectable: true,
    menu: [],
  };
}

/** Library → …path crumbs for the breadcrumb bar. */
function buildCrumbs(path: string): Array<{ name: string; path: string }> {
  const crumbs = [{ name: 'Library', path: ROOT }];
  if (path === ROOT) return crumbs;
  let acc = '';
  for (const segment of path.slice(1).split('/')) {
    acc += `/${segment}`;
    crumbs.push({ name: segment, path: acc });
  }
  return crumbs;
}

export function ComposerLibraryCanvasBody({
  onConfirm,
  onClose,
}: {
  onConfirm: (picks: { files: ComposerLibraryFile[]; folders: ComposerLibraryFolder[] }) => void;
  onClose: () => void;
}) {
  const [path, setPath] = useState<string>(ROOT);
  // Each open reads the live Library, so nothing is cached past this canvas.
  const libraryQuery = useQuery({
    queryKey: chatQueryKeys.composerLibrary(useOrganizationId(), path),
    queryFn: () => loadComposerLibrary(path),
    staleTime: 0,
    gcTime: 0,
  });
  const listing = libraryQuery.data ?? EMPTY_LISTING;
  const items = useMemo(
    () => [...listing.folders.map(folderItem), ...listing.files.map(fileItem)],
    [listing],
  );
  const selection = useBrowserSelection(items);
  const { selected, clear } = selection;

  const navigate = useCallback(
    (next: string) => {
      // Leaving a folder drops the selection (the Library page's own semantics).
      clear();
      setPath(next);
    },
    [clear],
  );

  const confirm = useCallback(() => {
    const files = listing.files.filter((f) => selected.has(`${FILE_PREFIX}${f.id}`));
    const folders = listing.folders.filter((f) => selected.has(`${FOLDER_PREFIX}${f.path}`));
    onConfirm({ files, folders });
    onClose();
  }, [listing, selected, onConfirm, onClose]);

  const onOpenItem = useCallback(
    (item: BrowserItem) => {
      if (item.kind === 'folder') navigate(item.key.slice(FOLDER_PREFIX.length));
      else selection.toggle(item.key);
    },
    [navigate, selection],
  );

  const count = selected.size;
  const empty = libraryQuery.isSuccess && items.length === 0;

  return (
    <>
      <ModalHeader align="start">
        <ModalTitle>Add from library</ModalTitle>
      </ModalHeader>
      <ModalContent>
        {path !== ROOT ? (
          <div className="pb-3">
            <BrowserBreadcrumbs crumbs={buildCrumbs(path)} onNavigate={navigate} />
          </div>
        ) : null}

        {libraryQuery.isPending ? (
          <BrowserSkeletons view="grid" label="Loading your Library" />
        ) : libraryQuery.isError ? (
          <PickerError
            message="Your Library didn’t load."
            onRetry={() => void libraryQuery.refetch()}
          />
        ) : empty ? (
          <PickerEmpty
            icon={IconFolderX}
            title={path === ROOT ? 'Your Library is empty' : 'This folder is empty'}
            hint="Files and folders you add to your Library show up here, ready to attach."
          />
        ) : (
          <BrowserGrid
            items={items}
            selected={selection.selected}
            selectionMode={selection.selectionMode}
            onOpen={onOpenItem}
            onItemClick={selection.onItemClick}
            onToggleSelect={selection.toggle}
            renamingKey={null}
            dragKeysFor={selection.dragKeysFor}
            setContextMenu={noopContextMenu}
          />
        )}
      </ModalContent>
      <ModalFooter left={count > 0 ? <SelectionCount count={count} /> : undefined}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={count === 0}>
          {count === 0 ? 'Attach' : `Attach ${count}`}
        </Button>
      </ModalFooter>
    </>
  );
}

function SelectionCount({ count }: { count: number }) {
  return <span className="text-meta text-muted-foreground">{count} selected</span>;
}

const EMPTY_LISTING: ComposerLibraryListing = { folders: [], files: [] };
