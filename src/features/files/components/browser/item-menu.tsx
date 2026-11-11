'use client';

import * as React from 'react';
import { IconDotsHorizontal } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { BrowserContextMenuState, BrowserMenuEntry } from './types';

// The item menu is a touch narrower than the 240px menu default — its labels
// (Rename · Move to… · Delete) sit comfortably at this width.
const ITEM_MENU_WIDTH = 'min-w-[190px]';

// Tile menus and right-click menus share one BrowserMenuEntry list.
// Anchor the controlled DropdownMenu to a zero-size cursor trigger.

function menuEntriesContent(entries: BrowserMenuEntry[]): React.ReactNode {
  return entries.map((entry) =>
    entry.kind === 'separator' ? (
      <DropdownMenuSeparator key={entry.id} />
    ) : (
      <DropdownMenuItem
        key={entry.id}
        disabled={entry.disabled}
        className={entry.destructive ? 'text-destructive focus:text-destructive' : undefined}
        onSelect={entry.onSelect}
      >
        {entry.icon ? (
          // Destructive items paint the glyph the same red as the label — the
          // menu's icon-colour rule only spares svgs that already carry a
          // text- class, so the destructive item must state it explicitly.
          <entry.icon className={cn('size-4', entry.destructive && 'text-destructive')} />
        ) : null}
        {entry.label}
      </DropdownMenuItem>
    ),
  );
}

/** The hover ⋯ trigger on a tile / row. */
export function ItemMenuButton({
  name,
  entries,
  size = 'icon-xs',
  className,
}: {
  name: string;
  entries: BrowserMenuEntry[];
  /** Rows use the toolbar size; grid tiles use the quiet corner size. */
  size?: 'icon-xs' | 'icon-2xs';
  className?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Hidden at rest and revealed on row hover, focus, or while open. */}
        <Button
          type="button"
          variant="ghost"
          size={size}
          aria-label={`Actions for ${name}`}
          className={cn(
            'text-muted-foreground transition-opacity duration-150 hover:text-foreground',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
            'data-[state=open]:opacity-100',
            className,
          )}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <IconDotsHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      {/* Menu close must NOT restore focus to the trigger: actions like
          inline-rename mount an autofocused input, and the restore would blur
          it immediately (committing nothing). */}
      <DropdownMenuContent
        align="end"
        className={ITEM_MENU_WIDTH}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menuEntriesContent(entries)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The right-click menu: one instance per browser view, fed by whichever item
    was context-clicked. */
export function BrowserContextMenu({
  state,
  onClose,
}: {
  state: BrowserContextMenuState;
  onClose: () => void;
}) {
  if (state === null) return null;
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="fixed size-0"
          style={{ left: state.position.x, top: state.position.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="bottom"
        className={ITEM_MENU_WIDTH}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {menuEntriesContent(state.item.menu)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
