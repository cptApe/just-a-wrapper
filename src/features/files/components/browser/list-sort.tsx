'use client';

import { IconArrowDown, IconArrowUp } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { SortDir, SortKey, SortSpec } from '../../lib/library-items';

// The list's sort controls: one button per column from sm up, one menu on
// phones where the rows fold their columns into a single meta line.

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  kind: 'Type',
  modified: 'Modified',
  size: 'Size',
};

// Re-picking the active column flips it; a fresh column starts in its natural
// direction: names ascending, dates and sizes newest or biggest first.
export function nextSort(sort: SortSpec, key: SortKey): SortSpec {
  if (sort.key === key) return { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'name' || key === 'kind' ? 'asc' : 'desc' };
}

export function PhoneSortMenu({
  sort,
  onSortChange,
}: {
  sort: SortSpec;
  onSortChange: (sort: SortSpec) => void;
}) {
  const Arrow = sort.dir === 'asc' ? IconArrowUp : IconArrowDown;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Sort by ${SORT_LABELS[sort.key]}`}
          className={cn(
            'inline-flex min-h-11 items-center gap-1 rounded-md px-1 -mx-1 text-title-card text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {SORT_LABELS[sort.key]}
          <Arrow className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[190px]">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={sort.key}>
          {(['name', 'kind', 'modified', 'size'] as const).map((key) => (
            <DropdownMenuRadioItem
              key={key}
              value={key}
              onSelect={() => onSortChange(nextSort(sort, key))}
            >
              {SORT_LABELS[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // Negative margin cancels the hit-area padding so the label starts on
        // the same x as the cells below it.
        'inline-flex h-8 max-sm:min-h-11 items-center gap-1 rounded-md px-1 -mx-1 text-title-card',
        'text-muted-foreground hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        active && 'text-foreground',
      )}
    >
      {label}
      {active ? (
        dir === 'asc' ? (
          <IconArrowUp className="size-3.5" aria-hidden />
        ) : (
          <IconArrowDown className="size-3.5" aria-hidden />
        )
      ) : null}
    </button>
  );
}
