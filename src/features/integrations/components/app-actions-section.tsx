'use client';

import { ErrorState } from '@/components/layouts/error-state';
import { InfoHint } from '@/components/ui/info-hint';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ToolActionRow,
  ToolActionsGroups,
} from '@/features/permissions/components/tool-actions';
import { useToolkitPermissions } from '@/features/permissions/hooks/use-toolkit-permissions';
import { defaultPolicyForToolAccess } from '@/features/permissions/lib/classify';
import { useIntegrationActions } from '../api/use-integration-actions';

// Actions group into Read-only and Write-delete with group and per-tool policies.
// Use the same classifier as permission gates. Render human phrases, not raw action ids.

export function AppActionsSection({ slug }: { slug: string }) {
  const actions = useIntegrationActions(slug);
  const { state: permissions, updateMany } = useToolkitPermissions(slug);

  if (permissions.kind === 'error') {
    return (
      <ErrorState
        title="Couldn’t load your permission settings"
        message="Close this and try again. Your saved choices are unaffected."
      />
    );
  }

  const rows: ToolActionRow[] =
    actions.kind === 'success'
      ? actions.actions.map((action) => {
          return {
            id: action.slug,
            title: action.phrase,
            access: action.access,
            policyAccess: action.access,
            toolNames: [action.slug],
            governable: true as const,
            defaultPolicy: defaultPolicyForToolAccess(action.access),
          };
        })
      : [];

  return (
    <section aria-label="Actions" className="flex min-h-0 flex-col gap-4">
      <ActionsIntro />
      {actions.kind === 'loading' || permissions.kind === 'loading' ? (
        <RowsSkeleton />
      ) : actions.kind === 'error' ? (
        <ErrorState title={actions.notice.title} message={actions.notice.body} />
      ) : rows.length === 0 ? (
        <p className="py-2 text-meta text-muted-foreground">
          This app has no configurable actions yet.
        </p>
      ) : (
        <ToolActionsGroups
          rows={rows}
          permissions={permissions.permissions}
          onApply={updateMany}
          disabled={false}
        />
      )}
    </section>
  );
}

function ActionsIntro() {
  return (
    <div className="flex items-center gap-1">
      <p className="text-meta text-muted-foreground">Choose what your agent can do on its own.</p>
      <InfoHint label="What Allow, Ask first, and Block mean">
        Allow runs the action without asking, Ask first checks with you every time, and Block stops
        it from ever running.
      </InfoHint>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {[0, 1].map((i) => (
        <Skeleton key={i} className="h-11 rounded-md" />
      ))}
    </div>
  );
}
