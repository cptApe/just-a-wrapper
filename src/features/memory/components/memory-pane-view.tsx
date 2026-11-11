'use client';

import type { ComponentProps, ReactNode, Ref } from 'react';
import { IconFile02, IconLock01, IconSearchMd, IconTrash01 } from '@/components/icons';
import { PageBody } from '@/components/layouts/page-shell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  BrowserBreadcrumbs,
  BrowserGrid,
  BrowserList,
  BrowserSkeletons,
} from '@/features/files/browser';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import type { memoryBreadcrumbs } from '../lib/memory-breadcrumbs';
import type { MemoryScopeAccess } from '../types';
export function MemoryPaneView({
  atRoot,
  inTrash,
  access,
  layout,
  trimmedQ,
  searchResults,
  crumbs,
  navigate,
  loading,
  errored,
  invalidate,
  gridProps,
  listProps,
  hasMore,
  sentinelRef,
}: {
  atRoot: boolean;
  inTrash: boolean;
  access: MemoryScopeAccess | null;
  layout: 'grid' | 'list';
  trimmedQ: string;
  searchResults: ReactNode;
  crumbs: ReturnType<typeof memoryBreadcrumbs>;
  navigate: (path: string) => void;
  loading: boolean;
  errored: boolean;
  invalidate: () => void;
  gridProps: ComponentProps<typeof BrowserGrid>;
  listProps: ComponentProps<typeof BrowserList>;
  hasMore: boolean;
  sentinelRef: Ref<HTMLDivElement>;
}) {
  const readOnly = access !== null && !access.canEdit;
  const searching = searchResults !== null && searchResults !== undefined;
  return (
    <>
      <PageBody className="flex flex-col gap-4">
        {readOnly && !inTrash && !searching ? (
          <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
            <IconLock01 className="size-3.5" aria-hidden />
            Shared with everyone in the workspace. Only admins can change it.
          </p>
        ) : null}
        {/* The empty trash state says the same thing, so the line shows only
            above deleted notes. */}
        {inTrash && gridProps.items.length > 0 ? (
          <p className="text-meta text-muted-foreground">
            Deleted notes stay here for 30 days, then they’re gone for good.
          </p>
        ) : null}
        {!atRoot && !searching ? (
          <BrowserBreadcrumbs crumbs={crumbs} onNavigate={navigate} />
        ) : null}

        {searching ? (
          searchResults
        ) : !atRoot && !access?.ready ? (
          <EmptyState
            icon={IconSearchMd}
            title="Memory isn’t set up yet"
            description={CAPABILITY_OFF_MESSAGES.memory}
          />
        ) : loading ? (
          <BrowserSkeletons view={layout} label="Loading memory" />
        ) : errored ? (
          <EmptyState
            icon={IconSearchMd}
            title="Couldn’t load memory"
            description="Couldn’t read this folder."
            action={
              <Button type="button" variant="secondary" size="sm" onClick={invalidate}>
                Try again
              </Button>
            }
          />
        ) : gridProps.items.length === 0 ? (
          <MemoryEmptyState filtered={trimmedQ !== ''} trash={inTrash} />
        ) : layout === 'grid' ? (
          <BrowserGrid {...gridProps} />
        ) : (
          <BrowserList {...listProps} />
        )}

        {hasMore && !searching ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
      </PageBody>
    </>
  );
}

// A query outside Recently deleted shows the search results instead, so a filtered list is the trash.
function MemoryEmptyState({ filtered, trash }: { filtered: boolean; trash: boolean }) {
  if (filtered) {
    return <EmptyState icon={IconSearchMd} title="No deleted notes match that search" />;
  }
  if (trash) {
    return (
      <EmptyState
        icon={IconTrash01}
        title="Deleted notes wait here for 30 days before they’re gone for good"
      />
    );
  }
  return (
    <EmptyState
      icon={IconFile02}
      title="As you work together, your agent takes notes here about you and how you like things done"
    />
  );
}
