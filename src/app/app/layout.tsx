import { headers } from 'next/headers';
import { OverlayHost } from '@/app/_overlays/overlay-host';
import { ContactDetailsProvider } from '@/components/providers/contact-details-provider';
import { DeploymentCapabilitiesProvider } from '@/components/providers/deployment-capabilities-provider';
import { plansForSale } from '@/features/billing/lib/billing-mode-rules';
import { FileLinkMarkdownProvider } from '@/features/chat/components/file-link-markdown-provider';
import { BrowserTimeZoneSync } from '@/features/preferences';
import { getOptionalDisplayPreferences } from '@/features/preferences/api/get-preferences';
// Direct component import: the realtime barrel re-exports the server-only publish
// helper, which must never reach a client bundle.
import { WorkspaceResync } from '@/features/realtime/components/workspace-resync';
import { SchedulesCapabilityProvider } from '@/features/scheduled/components/schedules-capability-provider';
// Direct component import — the search barrel is its server-API surface
// (same precedent as the overlay registry's component imports).
import { CommandSearch } from '@/features/search/components/command-search';
// Direct component import — the theme feature's edit-mode host (server half:
// reads the token list; client half: the floating card), same precedent.
import { ThemeEditMount } from '@/features/theme/components/theme-edit-mount';
import { MediaCapabilityProvider } from '@/features/voice/browser';
import { ensureRequestOrganization } from '@/features/workspaces/api/ensure-request-organization';
import { readContactDetails } from '@/lib/brand/contact';
import { env } from '@/lib/env';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';
import { billingCapability, capabilities } from '@/lib/runtime-capabilities';
import { AppProviders } from './_providers/app-providers';

// Root one overlay host, command menu and workspace-scoped QueryClient above both shells.
// Child layouts enforce auth; shared cached session reads avoid duplicate auth calls.
// The canvas-push-region lets floating previews shrink both shells at wide viewports.
// See docs/spec/03-patterns.md and docs/spec/09-modals.md.
export default async function AppSegmentLayout({ children }: { children: React.ReactNode }) {
  // The overlay host sits here, above the shell gate, so it needs the provisioned workspace
  // too: a first sign-up has no active organization on its session yet. The per-request
  // cache makes this the same resolution the gate runs.
  const { organizationId, userId, browserTimeZone } = await withRequestContext(
    { route: 'app-segment-layout' },
    async () => {
      try {
        const session = await getRequestSession();
        return {
          organizationId: session === null ? null : await ensureRequestOrganization(),
          userId: session?.user.id ?? null,
          browserTimeZone: session?.user.browserTimezone ?? null,
        };
      } catch (error) {
        // A hiccup here only means the cache falls back to a null-scoped key for
        // this render; the child layout still gates auth. Never block the app.
        captureException(error, { route: 'app-segment-layout', op: 'resolve-workspace' });
        return { organizationId: null, userId: null, browserTimeZone: null };
      }
    },
  );
  // Every date in the app is formatted in the person's zone and clock from the first paint.
  const displayFormat = await withRequestContext({ route: 'app-segment-layout' }, async () =>
    getOptionalDisplayPreferences(await headers()),
  );

  const [billing, contact] = await withRequestContext({ route: 'app-segment-layout' }, () =>
    Promise.all([billingCapability(), readContactDetails()]),
  );

  return (
    <ContactDetailsProvider value={contact}>
      <DeploymentCapabilitiesProvider
        value={{
          billing: billing.kind === 'stripe',
          plansForSale: plansForSale(billing),
          connectedApps: capabilities.connectedApps.kind === 'composio',
        }}
      >
        <SchedulesCapabilityProvider emailEnabled={capabilities.email.kind !== 'off'}>
          <MediaCapabilityProvider enabled={capabilities.media.kind === 'gateway'}>
            <AppProviders organizationId={organizationId} displayFormat={displayFormat}>
              <BrowserTimeZoneSync userId={userId} browserTimeZone={browserTimeZone} />
              <WorkspaceResync organizationId={organizationId} userId={userId} />
              <FileLinkMarkdownProvider>
                <div className="canvas-push-region">{children}</div>
                <OverlayHost />
              </FileLinkMarkdownProvider>
              <CommandSearch />
              {env.NEXT_PUBLIC_ENABLE_ADMIN_ROUTES === 'true' ? <ThemeEditMount /> : null}
            </AppProviders>
          </MediaCapabilityProvider>
        </SchedulesCapabilityProvider>
      </DeploymentCapabilitiesProvider>
    </ContactDetailsProvider>
  );
}
