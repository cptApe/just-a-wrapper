'use client';

import { IconChevronDown } from '@/components/icons';
import { PageHeader } from '@/components/layouts/page-shell';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { ToolbarDivider } from '@/components/ui/toolbar';

// Only the invariant frame. File counts, folders, empty states and breadcrumbs
// are data-dependent, so no guessed tiles appear beneath the toolbar.
export function LibraryPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the library">
      <PageHeader
        title="Library"
        action={
          <>
            <Skeleton className="h-9 w-[180px] rounded-button max-md:min-w-0 max-md:flex-1 md:w-[240px]" />
            <Button size="sm" disabled>
              New
              <IconChevronDown className="size-3.5" aria-hidden />
            </Button>
          </>
        }
      />
      <StickyToolbar>
        <Segmented
          label="Library surface"
          value={null}
          disabled
          onChange={() => undefined}
          options={[
            { value: 'files', label: 'Files' },
            { value: 'memory', label: 'Memory' },
          ]}
        />
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1">
            <Skeleton className="size-9 rounded-button" />
            <ToolbarDivider />
            <Skeleton className="size-9 rounded-button" />
            <Skeleton className="size-9 rounded-button" />
          </div>
        </div>
      </StickyToolbar>
    </div>
  );
}
