'use client';

import type { ReactNode } from 'react';
import { IconLayoutGrid01, IconList, IconTrash01 } from '@/components/icons';
import { DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { FunnelMenu } from '@/components/ui/funnel-menu';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { IconToggle, ToolbarDivider } from '@/components/ui/toolbar';
import { BrowserActionBar, SelectionCount } from '@/features/files/browser';
export function MemoryPaneToolbar({
  selectionCount,
  onClear,
  onDeleteSelected,
  pending,
  tabToggle,
  atRoot,
  inTrash,
  onToggleTrash,
  layout,
  onLayoutChange,
}: {
  selectionCount: number;
  onClear: () => void;
  onDeleteSelected: () => void;
  pending: boolean;
  tabToggle: ReactNode;
  atRoot: boolean;
  inTrash: boolean;
  onToggleTrash: (checked: boolean) => void;
  layout: 'grid' | 'list';
  onLayoutChange: (layout: 'grid' | 'list') => void;
}) {
  const selectionMode = selectionCount > 0;
  return (
    <StickyToolbar>
      <BrowserActionBar
        active={selectionMode}
        count={selectionCount}
        onClear={onClear}
        actions={[
          {
            id: 'delete',
            label: 'Delete',
            icon: IconTrash01,
            onSelect: onDeleteSelected,
            disabled: pending,
            destructive: true,
          },
        ]}
      >
        {tabToggle}
      </BrowserActionBar>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          {/* Only the leftmost item swaps between states; the divider +
              view toggle stay put (same contract as the Files toolbar). */}
          {selectionMode ? (
            <SelectionCount count={selectionCount} />
          ) : !atRoot ? (
            <FunnelMenu active={inTrash}>
              <DropdownMenuCheckboxItem checked={inTrash} onCheckedChange={onToggleTrash}>
                <IconTrash01 className="size-4" /> Recently deleted
              </DropdownMenuCheckboxItem>
            </FunnelMenu>
          ) : null}
          {selectionMode || !atRoot ? (
            <ToolbarDivider className={selectionMode ? 'max-sm:hidden' : undefined} />
          ) : null}
          <IconToggle
            label="Grid view"
            active={layout === 'grid'}
            onClick={() => onLayoutChange('grid')}
          >
            <IconLayoutGrid01 className="size-4" />
          </IconToggle>
          <IconToggle
            label="List view"
            active={layout === 'list'}
            onClick={() => onLayoutChange('list')}
          >
            <IconList className="size-4" />
          </IconToggle>
        </div>
      </div>
    </StickyToolbar>
  );
}
