'use client';

import { PageBody, PageHeader, PageShell } from '@/components/layouts/page-shell';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
import { AppsSectionSkeleton } from '@/features/integrations/components/apps-section-skeleton';

// Only the title, search and toolbar precede data-dependent catalog/notice
// content. Static tab labels use the real control so text metrics stay exact.
export default function Loading() {
  return (
    <PageShell>
      <div aria-busy="true" aria-label="Loading tools">
        <PageHeader
          title="Tools"
          className="pb-2"
          action={
            <Skeleton className="h-9 w-[180px] rounded-button max-md:min-w-0 max-md:flex-1 md:w-[240px]" />
          }
        />
        <StickyToolbar>
          {/* Segmented md: h-9 options, px-4, 14px labels (Apps · Skills · Built-in). */}
          <Segmented
            label="Tools sections"
            value={null}
            disabled
            onChange={() => undefined}
            options={[
              { value: 'apps', label: 'Apps' },
              { value: 'skills', label: 'Skills' },
              { value: 'built-in', label: 'Built-in' },
            ]}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="size-9 rounded-button" />
          </div>
        </StickyToolbar>
        <PageBody className="flex flex-col gap-8 pt-5">
          <AppsSectionSkeleton />
        </PageBody>
      </div>
    </PageShell>
  );
}
