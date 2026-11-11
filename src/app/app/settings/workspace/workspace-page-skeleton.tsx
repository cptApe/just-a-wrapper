import { RowAction } from '@/components/settings/row-action';
import { SettingsAvatarHeroSkeleton } from '@/components/settings/settings-avatar-hero-skeleton';
import { SettingsDetailRowSkeleton } from '@/components/settings/settings-detail-row-skeleton';
import { SettingsSection } from '@/components/settings/settings-section';
import { WorkspacePlanRowSkeleton } from '@/features/workspaces/components/workspace-plan-row';

// Mirrors the Workspace page for an admin on a paid plan: identity hero over
// the plan card, the General section's name row, then the Danger zone with its
// two fixed rows. Static chrome renders as real text; only data pulses. The
// danger actions start disabled, as they are for anyone with one workspace.
export function WorkspacePageSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading workspace">
      <div className="flex flex-col items-start gap-5">
        <SettingsAvatarHeroSkeleton />
        <WorkspacePlanRowSkeleton />
      </div>

      <SettingsSection title="General" divided={false}>
        <SettingsDetailRowSkeleton layout="stacked" label="Workspace name" trailing="Edit" />
      </SettingsSection>

      {/* WorkspaceDangerZone's hand-rolled section: destructive heading, pt-2 rows. */}
      <section className="flex flex-col gap-1 pt-12 first:pt-0">
        <h2 className="text-title-section text-destructive">Danger zone</h2>
        <div className="flex flex-col pt-2">
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Leave workspace"
            value="Remove yourself from this workspace."
            trailing={
              <RowAction destructive disabled>
                Leave workspace
              </RowAction>
            }
          />
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Delete workspace"
            value="Delete this workspace for everyone."
            trailing={
              <RowAction destructive disabled>
                Delete workspace
              </RowAction>
            }
          />
        </div>
      </section>
    </div>
  );
}
