'use client';

import { IconFile02, IconFolder } from '@/components/icons';
import { formatBytes } from '@/lib/format/format-bytes';
import { readLibraryListing } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

// Unfolded detail for `list_library_folder`: the folder's contents as a
// readable file list instead of the raw JSON the agent received. Errors and
// results that don't match the tool's contract fall back to the default
// detail so nothing ever renders silent.

export function LibraryFolderDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const listing = item.result.isError ? null : readLibraryListing(item.result.text);
  if (!listing) return <DefaultDetails item={item} />;

  if (listing.entries.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        {(listing.message ?? 'This folder is empty').replace(/\.$/, '')}
      </p>
    );
  }

  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto" data-testid="library-listing">
      {listing.entries.map((entry) => {
        const Icon = entry.kind === 'folder' ? IconFolder : IconFile02;
        return (
          <li key={entry.path} className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-meta">{entry.name}</span>
            <span className="shrink-0 text-meta font-medium text-muted-foreground">
              {entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size ?? 0)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
