import { headers } from 'next/headers';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { PageBody, PageHeader, PageShell } from '@/components/layouts/page-shell';
import { getDisplayPreferences } from '@/features/preferences/api/get-preferences';
import { listScheduledItems } from '@/features/tasks';
import { resolveCaller } from '@/lib/caller';
import { env } from '@/lib/env';
import { withRequestContext } from '@/lib/request-context';
import { ScheduledIsland } from './scheduled-island';
import { ScheduledPageSkeleton } from './scheduled-page-skeleton';

// The scheduled route supplies shared data to the client tabs.
// Tab and search refinements update shallow URL state inside the island.

export const metadata = { title: 'Scheduled' };

export default async function ScheduledPage() {
  return (
    <PageShell>
      <Boundary loading={<ScheduledPageSkeleton />} error={<ScheduledError />}>
        <ScheduledLoader />
      </Boundary>
    </PageShell>
  );
}

async function ScheduledLoader() {
  const { groups, defaultTimezone, organizationId } = await withRequestContext(
    { route: 'scheduled-page', feature: 'scheduled' },
    async () => {
      const h = await headers();
      const { workspaceId, organizationId, userId } = await resolveCaller(h);
      // New schedules default to the member's explicit choice, then the last
      // browser-detected zone, then UTC.
      const [groups, prefs] = await Promise.all([
        listScheduledItems({ workspaceId, viewerUserId: userId }),
        getDisplayPreferences(h),
      ]);
      return {
        groups,
        defaultTimezone: prefs.timeZone,
        organizationId,
      };
    },
  );
  // The client cache is scoped by the active organizationId (the tenant boundary
  // on the client) — the same value the sidebar keys on — so
  // the island seeds and reads the Tasks list under a workspace-consistent key.
  return (
    <ScheduledIsland
      groups={groups}
      defaultTimezone={defaultTimezone}
      organizationId={organizationId}
      hasLiveRunUpdates={env.ANTHROPIC_WEBHOOK_SECRET !== undefined}
    />
  );
}

function ScheduledError() {
  return (
    <>
      <PageHeader title="Scheduled" />
      <PageBody>
        <ErrorState
          title="Couldn’t load your scheduled runs"
          message="Something went wrong reading this workspace’s runs. Reload the page to try again."
        />
      </PageBody>
    </>
  );
}
