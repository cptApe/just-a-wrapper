'use client';

import * as React from 'react';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { formatBytes } from '@/lib/format/format-bytes';
import { formatDate } from '@/lib/format/format-date';
import { cn } from '@/lib/utils';
import { useSpringLoad } from '../../hooks/use-spring-load';
import type { SortSpec } from '../../lib/library-items';
import { thumbnailReducer } from '../../lib/thumbnail-machine';
import { thumbnailUrl } from '../../lib/thumbnail-url';
import { glyphClassName } from '../file-kind-icon';
import { showDragGhost } from './drag-ghost';
import { InlineRenameInput } from './inline-rename';
import { ItemMenuButton } from './item-menu';
import { ListRowSkeleton, ROW_GRID, ROW_RULE } from './list-row-skeleton';
import { nextSort, PhoneSortMenu, SORT_LABELS, SortButton } from './list-sort';
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

// The leading checkbox and trailing menu columns are always reserved so rest,
// hover and selection never reflow.

export function BrowserList({
  items,
  sort,
  onSortChange,
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
  onToggleSelectAll,
  allSelected = false,
  trailingSkeletons = 0,
}: BrowserRenderProps & {
  sort: SortSpec;
  onSortChange: (sort: SortSpec) => void;
  dragKeysFor: (key: string) => string[];
  setContextMenu: SetContextMenu;
  /** Header select-all toggle; omit when the view has no multi-select. */
  onToggleSelectAll?: () => void;
  allSelected?: boolean;
  trailingSkeletons?: number;
}) {
  const displayNameCounts = new Map<string, number>();
  for (const item of items) {
    displayNameCounts.set(item.name, (displayNameCounts.get(item.name) ?? 0) + 1);
  }

  return (
    // Rows pad 12px inside so the highlight has room around the checkbox; the
    // table pulls out by the same amount so columns stay on the page edge.
    <div role="table" aria-label="Items" className="-mx-3">
      <div
        role="row"
        className={cn(
          ROW_GRID,
          ROW_RULE,
          'group relative h-[42px] max-sm:min-h-11 max-sm:grid-cols-[24px_minmax(0,1fr)_auto]',
        )}
      >
        {/* Select-all circle: shown while a selection exists and hover-revealed
            otherwise. The column is always reserved so the Name header never moves. */}
        <div role="columnheader">
          {onToggleSelectAll ? (
            <SelectionCheckbox
              name="all"
              checked={allSelected}
              forceVisible={selectionMode}
              onToggle={onToggleSelectAll}
            />
          ) : null}
        </div>
        {/* Phone rows fold type, date and size into one meta line, so the
            header is one sort menu instead of four column buttons. */}
        <div
          role="columnheader"
          aria-label="Sort"
          className="col-span-2 flex justify-end sm:hidden"
        >
          <PhoneSortMenu sort={sort} onSortChange={onSortChange} />
        </div>
        {(['name', 'kind', 'modified', 'size'] as const).map((key) => (
          <div
            role="columnheader"
            className="max-sm:hidden"
            key={key}
            aria-sort={
              sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
            }
          >
            <SortButton
              label={SORT_LABELS[key]}
              active={sort.key === key}
              dir={sort.dir}
              onClick={() => onSortChange(nextSort(sort, key))}
            />
          </div>
        ))}
        <div role="columnheader" aria-label="Actions" className="hidden sm:block" />
      </div>
      <div role="rowgroup">
        {items.map((item, index) => (
          <ListRow
            key={item.key}
            item={item}
            nextSelected={selected.has(items[index + 1]?.key ?? '')}
            displayName={
              (displayNameCounts.get(item.name) ?? 0) > 1
                ? (item.renameName ?? item.name)
                : item.name
            }
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
        ))}
        {Array.from({ length: trailingSkeletons }, (_, i) => (
          <ListRowSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    </div>
  );
}

function ListRow({
  item,
  displayName,
  selected,
  nextSelected,
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
  displayName: string;
  selected: boolean;
  nextSelected: boolean;
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
  const { timeZone } = useDisplayFormat();
  const [imageState, imageEvent] = React.useReducer(thumbnailReducer, { kind: 'thumbnail' });
  const [dropActive, setDropActive] = React.useState(false);
  const droppable = onDropMove !== undefined && item.dropTargetPath !== undefined;
  // Dwelling over a folder row mid-drag spring-loads it open (same navigation
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
      if (item.selectable) onToggleSelect(item.key);
      return;
    }
    if (interaction === 'open') {
      // Library page: a plain click opens; selection is entered only via the
      // corner/leading select control (handled above once selectionMode is on).
      onOpen(item);
      return;
    }
    if (window.matchMedia('(pointer: coarse)').matches) {
      onOpen(item);
      return;
    }
    onItemClick(item, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
  }

  return (
    <div
      role="row"
      className={cn(
        ROW_GRID,
        ROW_RULE,
        'group relative isolate h-[65px] max-sm:h-auto max-sm:min-h-[65px] max-sm:gap-y-1 max-sm:py-3',
        // The highlight is a rounded pill behind the row, inset so neighbouring
        // selected rows read as separate pills.
        'before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-0.5 before:-z-10 before:rounded-md',
        selected && 'before:bg-alpha-6',
        // Neither a selected row nor the row above it draws a hairline along the pill.
        (selected || nextSelected) && 'after:opacity-0',
        // Armed (about to spring open) reads stronger than a plain drop hover.
        dropActive && (spring.armed ? 'before:bg-alpha-16' : 'before:bg-alpha-12'),
      )}
      {...(droppable
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
        : {})}
    >
      {/* Leading selection cell — reserved even for unselectable items so
          names align and hover never reflows. */}
      <span role="cell" className="flex items-center max-sm:row-span-2">
        {/* Row-wide target painted first so the controls after it stay clickable. */}
        <button
          type="button"
          aria-label={selectionMode && item.selectable ? `Select ${realName}` : `Open ${realName}`}
          draggable={onDropMove !== undefined && item.selectable && !renaming}
          onDragStart={(e) => {
            const keys = dragKeysFor(item.key);
            writeDragKeys(e.dataTransfer, keys);
            showDragGhost(e, keys.length);
          }}
          onClick={handleClick}
          onMouseEnter={onIntent ? () => onIntent(item) : undefined}
          onFocus={onIntent ? () => onIntent(item) : undefined}
          onDoubleClick={() => {
            // Click already opens in 'open' mode; double-click opens only in
            // 'select' mode.
            if (interaction === 'select' && !renaming) onOpen(item);
          }}
          onContextMenu={(e) => {
            if (item.menu.length === 0) return;
            e.preventDefault();
            setContextMenu({ item, position: { x: e.clientX, y: e.clientY } });
          }}
          className={cn(
            'absolute inset-0 rounded-md',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:ring-inset',
          )}
        />
        {item.selectable ? (
          <span className="relative inline-flex">
            <SelectionCheckbox
              name={item.name}
              checked={selected}
              forceVisible={selectionMode}
              onToggle={() => onToggleSelect(item.key)}
            />
          </span>
        ) : null}
      </span>
      <span
        role="cell"
        className="pointer-events-none flex min-w-0 items-center gap-3 max-sm:col-start-2 max-sm:row-start-1"
      >
        {item.imageSrc !== null && imageState.kind !== 'failed' ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob serves the resized thumbnail
          <img
            src={imageState.kind === 'original' ? item.imageSrc : thumbnailUrl(item.imageSrc)}
            onError={() => imageEvent()}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="size-[30px] shrink-0 rounded-md object-cover"
          />
        ) : (
          <span className="flex size-[30px] shrink-0 items-center justify-center" aria-hidden>
            <item.glyph className={glyphClassName(item.glyphTone, 'size-5')} />
          </span>
        )}
        {renaming && onRenameCommit && onRenameCancel ? (
          <span className="pointer-events-auto min-w-0 flex-1">
            <InlineRenameInput
              initialValue={item.renameName ?? item.name}
              onCommit={(name) => onRenameCommit(item, name)}
              onCancel={onRenameCancel}
              className="max-w-md"
            />
          </span>
        ) : (
          <span
            className="min-w-0 break-words sm:truncate text-title-card font-normal text-foreground"
            title={realName}
          >
            {displayName}
          </span>
        )}
      </span>
      <span
        role="cell"
        className="pointer-events-none col-start-2 row-start-2 pl-[42px] text-meta text-muted-foreground sm:hidden"
      >
        {phoneMeta(item, timeZone)}
      </span>
      <span role="cell" className="hidden sm:block truncate text-title-card text-muted-foreground">
        {item.kindLabel ?? '—'}
      </span>
      <span role="cell" className="hidden sm:block text-title-card text-muted-foreground tabular">
        {item.modifiedAt !== null ? formatDate(item.modifiedAt, timeZone) : '—'}
      </span>
      <span role="cell" className="hidden sm:block text-title-card text-muted-foreground tabular">
        {item.sizeBytes !== null ? formatBytes(item.sizeBytes) : '—'}
      </span>
      {/* Trailing kebab cell — hover-revealed, fixed-width so it never
          reflows; hidden (cell reserved) while a selection exists. */}
      <span
        role="cell"
        className="relative flex items-center justify-end pr-1 max-sm:col-start-3 max-sm:row-start-1 max-sm:row-span-2"
      >
        {!selectionMode ? <ItemMenuButton name={item.name} entries={item.menu} /> : null}
      </span>
    </div>
  );
}

// The phone row's one meta line: date and size when known, else the grid caption
// (a folder's "3 items" or "Private to you"), never a bare dash.
function phoneMeta(item: BrowserItem, timeZone: string): string {
  const parts = [
    item.modifiedAt !== null ? formatDate(item.modifiedAt, timeZone) : null,
    item.sizeBytes !== null ? formatBytes(item.sizeBytes) : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(' · ') : item.caption;
}
