'use client';

import type * as React from 'react';
import {
  IconCornerUpRight,
  IconDownload01,
  IconLayoutGrid01,
  IconLink01,
  IconList,
  IconMessagePlusSquare,
  IconTrash01,
} from '@/components/icons';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FunnelMenu } from '@/components/ui/funnel-menu';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { IconToggle, ToolbarDivider } from '@/components/ui/toolbar';
import type { FilesPaneModel } from '../hooks/use-files-pane-model';
import { TYPE_FACETS } from '../lib/file-types';
import { BrowserActionBar, SelectionCount } from './browser/action-bar';
import { TYPE_FACET_LABELS } from './files-pane-states';

/** The toolbar row: the tab toggle or the selection's action bar on the left, filters and view on the right. */
export function FilesToolbar({
  filters,
  selection,
  dialogs,
  pending,
  tabToggle,
}: Pick<FilesPaneModel, 'filters' | 'selection' | 'dialogs' | 'pending'> & {
  tabToggle: React.ReactNode;
}) {
  const { browser } = selection;
  const shareable = selection.shareableTarget;
  return (
    <StickyToolbar>
      {/* The standard-page toolbar row: fixed h-9, tabs/action-bar left,
          options cluster right. Selection morphs the row in place. */}
      <BrowserActionBar
        active={browser.selectionMode}
        count={browser.selected.size}
        onClear={browser.clear}
        actions={[
          {
            id: 'new-task',
            label: 'New task',
            icon: IconMessagePlusSquare,
            onSelect: selection.newTaskWithSelection,
            disabled:
              pending ||
              (selection.selectedFiles.length === 0 && selection.selectedFolderPaths.length === 0),
          },
          {
            id: 'download',
            label: 'Download',
            icon: IconDownload01,
            onSelect: selection.downloadSelected,
            disabled: pending,
          },
          {
            id: 'move',
            label: 'Move',
            icon: IconCornerUpRight,
            onSelect: () => dialogs.openMove(selection.keysToSelection(selection.selectedKeys)),
            disabled: pending,
          },
          {
            id: 'share',
            label: 'Share',
            icon: IconLink01,
            onSelect: () => {
              if (shareable !== null) dialogs.openShare(shareable);
            },
            disabled: pending || shareable === null,
            disabledReason:
              shareable === null ? 'Share one file or one folder at a time' : undefined,
          },
          {
            id: 'delete',
            label: 'Delete',
            icon: IconTrash01,
            onSelect: selection.deleteSelected,
            disabled: pending,
            destructive: true,
          },
        ]}
      >
        {tabToggle}
      </BrowserActionBar>
      <div className="flex shrink-0 items-center gap-2">
        {/* Options cluster, right-anchored (ui/toolbar.tsx contract). Only the leftmost item
            swaps: the filter button while browsing, the "N selected" count while selecting.
            The divider and the view toggle to its right never move. */}
        <div className="flex items-center gap-1">
          {browser.selectionMode ? (
            <SelectionCount count={browser.selected.size} />
          ) : (
            <FunnelMenu active={filters.type !== null || filters.trash}>
              <DropdownMenuLabel>File type</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                // Recently deleted is its own view: while it is on, no type
                // row carries a checkmark, so exactly one item is ever checked.
                value={filters.trash ? '' : (filters.type ?? 'all')}
                onValueChange={(value) =>
                  filters.chooseType(TYPE_FACETS.find((facet) => facet === value) ?? null)
                }
              >
                <DropdownMenuRadioItem value="all">All types</DropdownMenuRadioItem>
                {TYPE_FACETS.map((facet) => (
                  <DropdownMenuRadioItem key={facet} value={facet}>
                    {TYPE_FACET_LABELS[facet]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={filters.trash}
                onCheckedChange={(checked) => filters.showDeleted(checked)}
              >
                <IconTrash01 className="size-4" /> Recently deleted
              </DropdownMenuCheckboxItem>
            </FunnelMenu>
          )}
          <ToolbarDivider className={browser.selectionMode ? 'max-sm:hidden' : undefined} />
          <IconToggle
            label="Grid view"
            active={filters.fileView === 'grid'}
            onClick={filters.showGrid}
          >
            <IconLayoutGrid01 className="size-4" />
          </IconToggle>
          <IconToggle
            label="List view"
            active={filters.fileView === 'list'}
            onClick={filters.showList}
          >
            <IconList className="size-4" />
          </IconToggle>
        </div>
      </div>
    </StickyToolbar>
  );
}
