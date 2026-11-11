'use client';

import * as React from 'react';
import { IconPlay } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSpringLoad } from '../../hooks/use-spring-load';
import { thumbnailReducer } from '../../lib/thumbnail-machine';
import { thumbnailUrl } from '../../lib/thumbnail-url';
import { glyphClassName } from '../file-kind-icon';
import { showDragGhost } from './drag-ghost';
import { InlineRenameInput } from './inline-rename';
import { ItemMenuButton } from './item-menu';
import { SelectionCheckbox } from './selection-checkbox';
import {
  type BrowserInteraction,
  type BrowserItem,
  type BrowserRenderProps,
  dragCarriesItems,
  isDraggingKey,
  leftDropTarget,
  readDragKeys,
  type SetContextMenu,
  writeDragKeys,
} from './types';
import { VideoPoster } from './video-poster';

// Images fill their tile; documents are tinted cards with a name, glyph and caption.
const TILE_SHAPE = 'rounded-xl';
export const GRID_LAYOUT = 'grid grid-cols-2 gap-4 sm:grid-cols-3';

export function GridTileSkeleton() {
  return <Skeleton className={cn('aspect-square', TILE_SHAPE)} />;
}

const tintedTile = cn(
  'absolute inset-0 flex flex-col p-4 text-left',
  TILE_SHAPE,
  'bg-alpha-6 hover:bg-alpha-8',
  'dark:shadow-[inset_0_0_0_1px_var(--color-alpha-6)]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:ring-inset',
);

export function BrowserGrid({
  items,
  selected,
  selectionMode,
  interaction = 'select',
  onOpen,
  onItemClick,
  onToggleSelect,
  onDropMove,
  onIntent,
  renamingKey,
  onRenameCommit,
  onRenameCancel,
  dragKeysFor,
  setContextMenu,
  trailingSkeletons = 0,
}: BrowserRenderProps & {
  dragKeysFor: (key: string) => string[];
  setContextMenu: SetContextMenu;
  /** Render N skeleton tiles after the items (infinite-scroll tail). */
  trailingSkeletons?: number;
}) {
  return (
    <ul className={GRID_LAYOUT}>
      {items.map((item) => (
        <li key={item.key} className="group relative">
          <GridTile
            item={item}
            selected={selected.has(item.key)}
            selectionMode={selectionMode}
            interaction={interaction}
            onOpen={onOpen}
            onItemClick={onItemClick}
            onToggleSelect={onToggleSelect}
            onDropMove={onDropMove}
            onIntent={onIntent}
            renaming={renamingKey === item.key}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            dragKeysFor={dragKeysFor}
            setContextMenu={setContextMenu}
          />
        </li>
      ))}
      {Array.from({ length: trailingSkeletons }, (_, i) => (
        <li key={`skeleton-${i}`} aria-hidden>
          <GridTileSkeleton />
        </li>
      ))}
    </ul>
  );
}

function GridTile({
  item,
  selected,
  selectionMode,
  interaction,
  onOpen,
  onItemClick,
  onToggleSelect,
  onDropMove,
  onIntent,
  renaming,
  onRenameCommit,
  onRenameCancel,
  dragKeysFor,
  setContextMenu,
}: {
  item: BrowserItem;
  selected: boolean;
  selectionMode: boolean;
  interaction: BrowserInteraction;
  onOpen: (item: BrowserItem) => void;
  onItemClick: (item: BrowserItem, modifiers: { shift: boolean; meta: boolean }) => void;
  onToggleSelect: (key: string) => void;
  onDropMove?: (keys: string[], targetPath: string) => void;
  onIntent?: (item: BrowserItem) => void;
  renaming: boolean;
  onRenameCommit?: (item: BrowserItem, name: string) => void;
  onRenameCancel?: () => void;
  dragKeysFor: (key: string) => string[];
  setContextMenu: SetContextMenu;
}) {
  const [dropActive, setDropActive] = React.useState(false);
  const [videoFailed, setVideoFailed] = React.useState(false);
  // A failed thumbnail retries with the original file; a dead original falls
  // back to the tinted glyph tile.
  const [imageState, imageEvent] = React.useReducer(thumbnailReducer, { kind: 'thumbnail' });
  const imageFailed = imageState.kind === 'failed';
  const droppable = onDropMove !== undefined && item.dropTargetPath !== undefined;
  // Dwelling over a folder tile mid-drag spring-loads it open (same navigation
  // as a click) so the drop can land deeper — never for the folder being
  // dragged, which would open the thing mid-move.
  const spring = useSpringLoad(() => {
    setDropActive(false);
    onOpen(item);
  });
  const springable = droppable && item.kind === 'folder';
  const realName = item.renameName ?? item.name;

  function handleClick(e: React.MouseEvent) {
    if (renaming) return;
    if (selectionMode) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        onItemClick(item, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        return;
      }
      // In selection mode the whole tile toggles — one tap per item, the only path on
      // touch.
      if (item.selectable) onToggleSelect(item.key);
      return;
    }
    if (interaction === 'open') {
      // Library page: a plain click opens. Selection is entered only through
      // the corner select control (handled above once selectionMode is on).
      onOpen(item);
      return;
    }
    if (window.matchMedia('(pointer: coarse)').matches) {
      // No double-tap on touch: tap opens.
      onOpen(item);
      return;
    }
    onItemClick(item, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
  }

  const interactionProps: React.HTMLAttributes<HTMLButtonElement> = {
    onClick: handleClick,
    onMouseEnter: onIntent ? () => onIntent(item) : undefined,
    onFocus: onIntent ? () => onIntent(item) : undefined,
    onDoubleClick: () => {
      // Double-click only opens in 'select' mode (click already opens in
      // 'open' mode — a second open would just re-fire).
      if (interaction === 'select' && !renaming) onOpen(item);
    },
    onContextMenu: (e) => {
      if (item.menu.length === 0) return;
      e.preventDefault();
      setContextMenu({ item, position: { x: e.clientX, y: e.clientY } });
    },
  };

  const dragProps = {
    draggable: onDropMove !== undefined && item.selectable && !renaming,
    onDragStart: (e: React.DragEvent) => {
      const keys = dragKeysFor(item.key);
      writeDragKeys(e.dataTransfer, keys);
      showDragGhost(e, keys.length);
    },
  };

  const dropProps = droppable
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!dragCarriesItems(e.dataTransfer)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropActive(true);
          if (springable && !isDraggingKey(item.key)) spring.arm();
        },
        onDragLeave: (e: React.DragEvent<HTMLElement>) => {
          if (leftDropTarget(e)) {
            spring.disarm();
            setDropActive(false);
          }
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          spring.disarm();
          setDropActive(false);
          const keys = readDragKeys(e.dataTransfer).filter((k) => k !== item.key);
          if (keys.length > 0 && item.dropTargetPath !== undefined) {
            onDropMove(keys, item.dropTargetPath);
          }
        },
      }
    : {};

  const label = selectionMode && item.selectable ? `Select ${realName}` : `Open ${realName}`;
  const videoSrc = videoFailed ? null : item.videoSrc;
  const showMedia = Boolean(videoSrc) || (item.imageSrc !== null && !imageFailed);

  return (
    <div
      className={cn('relative aspect-square overflow-hidden', TILE_SHAPE)}
      data-browser-item
      {...dropProps}
    >
      {showMedia ? (
        <button
          type="button"
          aria-label={label}
          className={cn(
            'absolute inset-0',
            TILE_SHAPE,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:ring-inset',
          )}
          {...interactionProps}
          {...dragProps}
        >
          {videoSrc ? (
            <VideoPoster src={videoSrc} onError={() => setVideoFailed(true)} />
          ) : item.imageSrc !== null ? (
            /* Plain <img> keeps the browser session on the private thumbnail route;
               the server creates the WebP once, so Next optimization is unnecessary. */
            /* eslint-disable-next-line @next/next/no-img-element -- Blob serves the resized thumbnail */
            <img
              src={imageState.kind === 'original' ? item.imageSrc : thumbnailUrl(item.imageSrc)}
              alt={realName}
              loading="lazy"
              decoding="async"
              onError={() => imageEvent()}
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
          ) : null}
          {item.playBadge ? (
            <span
              aria-hidden
              className="absolute bottom-3 left-3 flex size-8 items-center justify-center rounded-full bg-foreground/80 text-background"
            >
              <IconPlay className="size-4" />
            </span>
          ) : null}
          <span
            aria-hidden
            className="absolute inset-0 bg-alpha-6 opacity-0 group-hover:opacity-100"
          />
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_var(--color-alpha-6)]',
              TILE_SHAPE,
            )}
          />
        </button>
      ) : (
        <button
          type="button"
          aria-label={label}
          className={tintedTile}
          {...interactionProps}
          {...dragProps}
        >
          {renaming ? null : (
            <span
              className="relative line-clamp-2 pr-8 text-title-card text-foreground"
              title={realName}
            >
              {item.name}
            </span>
          )}
          {/* The glyph centres on the tile itself, so one- and two-line names
              and captions leave it at the same spot on every tile. */}
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
            <item.glyph className={glyphClassName(item.glyphTone, 'size-9')} strokeWidth={1.5} />
          </span>
          <span className="relative mt-auto pr-8 text-meta font-medium text-muted-foreground">
            {item.caption}
          </span>
        </button>
      )}

      {/* Selection ring + drop highlight sit above whichever tile face rendered. */}
      {selected ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 ring-2 ring-inset ring-foreground',
            TILE_SHAPE,
          )}
        />
      ) : null}
      {dropActive ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 ring-2 ring-inset ring-ring',
            // Armed (about to spring open) reads stronger than a plain drop hover.
            spring.armed ? 'bg-alpha-12' : 'bg-alpha-6',
            TILE_SHAPE,
          )}
        />
      ) : null}
      {/* Rename sits over the tile because the tile itself is a button; image tiles carry no name text. */}
      {renaming && onRenameCommit && onRenameCancel ? (
        <span
          className={
            item.imageSrc !== null ? 'absolute inset-x-3 bottom-3' : 'absolute inset-x-3 top-3'
          }
        >
          <InlineRenameInput
            initialValue={item.renameName ?? item.name}
            onCommit={(name) => onRenameCommit(item, name)}
            onCancel={onRenameCancel}
          />
        </span>
      ) : null}

      {/* The menu sits on the caption line and the selection circle on the
          title line, both centred 26px in from the right edge, so neither
          covers text. Media tiles give both a soft backdrop for contrast. */}
      {!selectionMode ? (
        <span className="absolute bottom-3 right-3 flex">
          <ItemMenuButton
            name={item.name}
            entries={item.menu}
            size="icon-2xs"
            className={cn(
              'hover:bg-alpha-8 data-[state=open]:bg-alpha-8',
              showMedia && 'bg-background/80 backdrop-blur-sm hover:bg-background',
            )}
          />
        </span>
      ) : null}
      {/* Rename takes the whole title line, so the circle steps aside. */}
      {item.selectable && !renaming ? (
        <span className="absolute right-3.5 top-3.5 flex">
          <SelectionCheckbox
            name={item.name}
            checked={selected}
            forceVisible={selectionMode}
            onToggle={() => onToggleSelect(item.key)}
          />
        </span>
      ) : null}
    </div>
  );
}
