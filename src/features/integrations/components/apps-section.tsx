'use client';

import { useQueryState } from 'nuqs';
import { IconCheckCircleSolid, IconSearchMd } from '@/components/icons';
import { ErrorState } from '@/components/layouts/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ListRow,
  ListRowContent,
  ListRowMeta,
  ListRowTitle,
  ListRowTrailing,
} from '@/components/ui/list-row';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { TOOLKIT_GROUPS, toolkitMetadata } from '@/lib/composio/toolkits';
import { toolsParsers } from '@/lib/tools-search-params';
import { rememberOpeningIntegrationView } from '../hooks/use-opening-integration-view';
import type { IntegrationsResult, IntegrationView } from '../types';
import { IntegrationLogo } from './integration-logo';

// Apps render in curated shelves with whole-row detail links and connected indicators.
// Filter by connection status and search name, blurb and tags.
// Search or filtering can produce empty state; the static catalog itself remains available.
// Request an app belongs below the catalog.

export function AppsSection({ initial }: { initial: IntegrationsResult }) {
  const [q] = useQueryState('q', toolsParsers.q);
  const [status] = useQueryState('status', toolsParsers.status);

  if (initial.status === 'notice') {
    return <ErrorState title={initial.notice.title} message={initial.notice.body} />;
  }
  const views = initial.integrations;
  const query = q.trim().toLowerCase();

  const matches = (view: IntegrationView): boolean => {
    const meta = toolkitMetadata(view.slug);
    if (query !== '') {
      const haystack = [view.name, view.blurb, ...(meta?.tags ?? [])].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (status === 'connected' && !view.connected) return false;
    if (status === 'not-connected' && view.connected) return false;
    return true;
  };

  const visible = views.filter(matches);
  const body =
    visible.length === 0 ? (
      <EmptyState
        icon={IconSearchMd}
        title={query !== '' ? `No apps match “${q.trim()}”` : 'No apps match this filter'}
      />
    ) : (
      <GroupedRows views={visible} />
    );

  return <div className="flex flex-col gap-6">{body}</div>;
}

function GroupedRows({ views }: { views: IntegrationView[] }) {
  const byGroup = new Map<string, IntegrationView[]>();
  for (const view of views) {
    const meta = toolkitMetadata(view.slug);
    const group = meta?.group ?? 'files-docs';
    byGroup.set(group, [...(byGroup.get(group) ?? []), view]);
  }
  return (
    <div className="flex flex-col gap-8">
      {TOOLKIT_GROUPS.map((group) => {
        const groupViews = byGroup.get(group.id);
        if (!groupViews || groupViews.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.label} className="flex flex-col gap-2">
            <h3 className="text-title-card font-semibold text-muted-foreground">{group.label}</h3>
            <AppRows views={groupViews} />
          </section>
        );
      })}
    </div>
  );
}

function AppRows({ views }: { views: IntegrationView[] }) {
  return (
    <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">
      {views.map((view) => (
        <li key={view.slug} className="min-w-0">
          <ListRow asChild className="min-h-16">
            <button
              type="button"
              onClick={() => {
                rememberOpeningIntegrationView(view);
                openOverlay(buildOverlayHash('app', view.slug));
              }}
              aria-label={`${view.name}, ${view.connected ? 'connected' : 'not connected'}. Open details`}
            >
              <IntegrationLogo logoUrl={view.logoUrl} name={view.name} slug={view.slug} size={40} />
              <ListRowContent>
                <ListRowTitle>{view.name}</ListRowTitle>
                <ListRowMeta className="text-meta font-medium">{view.blurb}</ListRowMeta>
              </ListRowContent>
              <ListRowTrailing>
                <AppRowState view={view} />
              </ListRowTrailing>
            </button>
          </ListRow>
        </li>
      ))}
    </ul>
  );
}

function AppRowState({ view }: { view: IntegrationView }) {
  if (view.error) {
    return <span className="text-meta font-medium text-muted-foreground">couldn’t check</span>;
  }
  if (view.connected) {
    // Connected reads at a glance: a large, light-green solid circle-check that
    // pops (non-technical users). Unconnected rows show nothing — the whole row
    // is the affordance.
    return <IconCheckCircleSolid aria-hidden="true" className="size-6 text-success-strong" />;
  }
  return null;
}
