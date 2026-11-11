import type * as React from 'react';
import type { Icon } from '@/components/icons';
import { captureException } from '@/lib/observability-client';
import { beginDrag, dragSnapshot } from '../../lib/drag-store';
import type { FileGlyphTone } from '../file-kind-icon';

// Neutral shared file-browser types let Files map drive items and Memory map
// notes into one grid, list, selection model and item menu.

export type BrowserMenuEntry =
  | {
      kind: 'action';
      id: string;
      label: string;
      icon?: Icon;
      destructive?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { kind: 'separator'; id: string };

export type BrowserItem = {
  /** Stable selection/render key ('file:…' | 'folder:…' | 'note:…'). */
  key: string;
  kind: 'folder' | 'doc';
  name: string;
  /** Full stored name used only while renaming when display text is shortened. */
  renameName?: string;
  /** Caption on the grid tile ('PDF • 391 KB' · '3 items' · 'Note · 2 KB'). */
  caption: string;
  /** ISO timestamp for the list's Modified column; null renders as —. */
  modifiedAt: string | null;
  /** Bytes for the Size column; null renders as —. */
  sizeBytes: number | null;
  /** Thumbnail source; null falls back to the glyph. */
  imageSrc: string | null;
  /** The list's Type column ('Folder', 'PDF', 'PNG'…); omitted renders as —. */
  kindLabel?: string;
  /** Video source for a grid tile's first-frame poster; takes the place of `imageSrc`. */
  videoSrc?: string | null;
  /** Video tiles show a poster frame plus a play badge over it. */
  playBadge?: boolean;
  glyph: Icon;
  /** Colour family for the glyph; omit for the neutral muted glyph. */
  glyphTone?: FileGlyphTone | null;
  /** Whether the checkbox/selection applies to this item. */
  selectable: boolean;
  /** Set on folders that accept drag-drop moves (their folder path). */
  dropTargetPath?: string;
  /** ⋯ / right-click entries; empty = no menu affordance. */
  menu: BrowserMenuEntry[];
};

/** How a plain click on an item is read:
    - 'open'   → the Library page: a click OPENS (folders navigate, docs
                 preview); selection is reached only through the corner select
                 control, and once anything is selected the whole item toggles.
    - 'select' → the canvas picker: a click SELECTS; opening is double-click / touch-tap. */
export type BrowserInteraction = 'open' | 'select';

type BrowserInteractions = {
  interaction?: BrowserInteraction;
  /** Open = plain click ('open' mode) / double-click / Enter (folders navigate,
      docs preview). */
  onOpen: (item: BrowserItem) => void;
  /** Single click — the selection model decides what it means. */
  onItemClick: (item: BrowserItem, modifiers: { shift: boolean; meta: boolean }) => void;
  onToggleSelect: (key: string) => void;
  /** Items being dragged were dropped on a folder / breadcrumb target. */
  onDropMove?: (keys: string[], targetPath: string) => void;
  /** A row shows intent to open (hover or focus). Warms its preview body. */
  onIntent?: (item: BrowserItem) => void;
  /** Key currently in inline-rename mode. */
  renamingKey?: string | null;
  onRenameCommit?: (item: BrowserItem, name: string) => void;
  onRenameCancel?: () => void;
};

const DRAG_MIME = 'application/x-just-a-wrapper-items';

export function dragCarriesItems(dt: DataTransfer): boolean {
  return dt.types.includes(DRAG_MIME);
}

export function isDraggingKey(key: string): boolean {
  const state = dragSnapshot();
  return state.kind === 'dragging' && state.keys.has(key);
}

export function readDragKeys(dt: DataTransfer): string[] {
  try {
    const raw = dt.getData(DRAG_MIME);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch (error) {
    // A foreign/mangled drag payload must degrade to "not our drag", never crash.
    captureException(error, { feature: 'files', op: 'read-drag-keys' });
    return [];
  }
}

export function writeDragKeys(dt: DataTransfer, keys: string[]): void {
  dt.setData(DRAG_MIME, JSON.stringify(keys));
  dt.effectAllowed = 'move';
  beginDrag(keys);
}

/** Ignore dragleave events caused by crossing descendants of one drop target. */
export function leftDropTarget(e: React.DragEvent<HTMLElement>): boolean {
  const next = e.relatedTarget;
  return !(next instanceof Node) || !e.currentTarget.contains(next);
}

/** Shared render context so grid + list treat selection identically. */
type BrowserSelectionState = {
  selected: ReadonlySet<string>;
  selectionMode: boolean;
};

export type BrowserRenderProps = BrowserSelectionState &
  BrowserInteractions & { items: BrowserItem[] };

export type BrowserContextMenuState = {
  item: BrowserItem;
  position: { x: number; y: number };
} | null;

export type SetContextMenu = React.Dispatch<React.SetStateAction<BrowserContextMenuState>>;
