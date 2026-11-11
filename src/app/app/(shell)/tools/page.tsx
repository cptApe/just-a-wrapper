import { headers } from 'next/headers';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { PageShell } from '@/components/layouts/page-shell';
import { AppsSection, VaultHealthBanner } from '@/features/integrations';
// Skeletons imported directly, not via the barrels (the same precedent as the
// client components below — the barrels are the server-API surfaces).
import { AppsSectionSkeleton } from '@/features/integrations/components/apps-section-skeleton';
import { getIntegrations, getMemberVaultHealth } from '@/features/integrations/server';
// Client policy UI — imported directly; the permissions barrel is server-only.
import { BuiltinToolsSection } from '@/features/permissions/components/builtin-tools-section';
import { builtinShelfCards } from '@/features/permissions/lib/builtin-shelf-search';
import { SkillsSection } from '@/features/skills';
import { SkillsSectionSkeleton } from '@/features/skills/components/skills-section-skeleton';
import { listSkillsForWorkspace } from '@/features/skills/server';
import { brand } from '@/lib/brand/identity';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';

export const metadata = {
  title: `${brand.name} · tools`,
};

// Tools streams Apps, Skills and Built-in independently behind their own boundaries.
// Search and Apps status filters apply only to the active tab. Rows open global hash overlays.
// The client shell owns the toolbar; Skills owns New.
// The parent layout ensures auth and member provisioning before render.
import { ToolsShell } from './tools-shell';

export default function ToolsPage() {
  return (
    <PageShell>
      <ToolsShell
        apps={
          <div className="flex flex-col gap-6">
            {capabilities.connectedApps.kind === 'composio' ? (
              <Boundary loading={null} error={<HealthError />}>
                <HealthLoader />
              </Boundary>
            ) : null}
            <Boundary loading={<AppsSectionSkeleton />} error={<AppsError />}>
              <AppsLoader />
            </Boundary>
          </div>
        }
        skills={
          <Boundary loading={<SkillsSectionSkeleton />} error={<SkillsError />}>
            <SkillsLoader />
          </Boundary>
        }
        builtin={<BuiltinToolsSection availableCards={builtinShelfCards(capabilities)} />}
      />
    </PageShell>
  );
}

async function HealthLoader() {
  return <VaultHealthBanner initial={await getMemberVaultHealth()} />;
}

function HealthError() {
  return (
    <p role="status" className="text-meta text-muted-foreground">
      Couldn’t check the agent connection. Reload to try again.
    </p>
  );
}

async function AppsLoader() {
  // getIntegrations self-wraps in withRequestContext (it's a server action), so
  // the loader just awaits it — no redundant outer context.
  const result = await getIntegrations();
  return <AppsSection initial={result} />;
}

async function SkillsLoader() {
  // Resolve both ids: `workspaceId` (the internal row) reads the list; the client
  // cache keys on `organizationId` — the tenant boundary `useOrganizationId()`
  // exposes — so the overlay/New-menu mutations land in the SAME cache the list
  // renders from.
  const { skills, organizationId } = await withRequestContext(
    { route: 'tools/skills' },
    async () => {
      const { workspaceId, organizationId } = await resolveCaller(await headers());
      return { skills: await listSkillsForWorkspace({ workspaceId }), organizationId };
    },
  );
  return <SkillsSection initialSkills={skills} organizationId={organizationId} />;
}

function AppsError() {
  return <ErrorState title="Couldn’t load your apps" message="Reload to try again." />;
}

function SkillsError() {
  return <ErrorState title="Couldn’t load your skills" message="Reload to try again." />;
}
