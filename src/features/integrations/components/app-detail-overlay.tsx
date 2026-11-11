'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { ModalSectionPanel, ModalSectionTabs } from '@/components/ui/modal-section-tabs';
// Type-only import — erased at compile time, no runtime edge back to the host.
import type { OverlayComponentProps } from '@/features/overlays/types';
import { type ToolkitMeta, toolkitLogoUrl, toolkitMetadata } from '@/lib/composio/toolkits';
import { useIntegrationStatus } from '../api/integration-status';
import { useIntegrationConnection } from '../hooks/use-integration-connection';
import { useOpeningIntegrationView } from '../hooks/use-opening-integration-view';
import type { IntegrationView } from '../types';
import { AppActionsSection } from './app-actions-section';
import {
  AccountsSection,
  IdentityHeader,
  OverlayNotice,
  OverviewSection,
} from './app-detail-sections';

// The app hash overlay resolves its own data from the toolkit slug for cold links.
// Render static catalog content immediately; refresh live connection status independently.
// Seed connection state from the list when available and preserve unknown on cold opens.
// Connection changes refresh the underlying Apps list.

const SECTIONS = [
  { value: 'overview' as const, label: 'Overview' },
  { value: 'actions' as const, label: 'Actions' },
  { value: 'accounts' as const, label: 'Accounts' },
];
type Section = (typeof SECTIONS)[number]['value'];

// Connection status is never persistently cached across opens because it is
// workspace-scoped. A list click hands the modal one short-lived snapshot; the
// opening-state hook consumes it after the first render. Direct links therefore
// still start at "Checking…" until refreshIntegration answers.

/** What we can render before the first status read answers. */
function provisionalView(meta: ToolkitMeta): IntegrationView {
  return {
    slug: meta.slug,
    name: meta.name,
    blurb: meta.blurb,
    logoUrl: toolkitLogoUrl(meta.slug),
    shared: { status: 'none' },
    canShare: false,
    connected: false,
    ownConnected: false,
    connectUrl: null,
    error: null,
  };
}

export function AppDetailOverlay({ id, open, onClose }: OverlayComponentProps) {
  const slug = id ?? '';
  const meta = toolkitMetadata(slug);

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // Phone: the tallest sheet, so switching tabs never moves its top edge.
      className={meta ? 'max-sm:h-full' : undefined}
    >
      {meta ? (
        <AppDetailFrame key={meta.slug} meta={meta} />
      ) : (
        <>
          <ModalHeader>
            <ModalTitle className="sr-only">App not available</ModalTitle>
          </ModalHeader>
          <ModalContent>
            <OverlayNotice
              title="This app isn’t available"
              body="It may have been removed from the catalog, or the link may be out of date."
            />
          </ModalContent>
        </>
      )}
    </Modal>
  );
}

function AppDetailFrame({ meta }: { meta: ToolkitMeta }) {
  const router = useRouter();
  const openingView = useOpeningIntegrationView(meta.slug);
  const { query } = useIntegrationStatus(meta.slug);
  const view = query.data ?? openingView ?? provisionalView(meta);
  // A list click supplies its already-rendered state synchronously. Cold links
  // remain unknown until the first live status read answers; a failed read still ends "Checking…".
  const statusKnown = openingView !== null || query.data !== undefined || query.isError;
  const [section, setSection] = useState<Section>('overview');

  // The connected flag last shown. Any status change (background check or user action)
  // refreshes the server-rendered Apps list under the overlay exactly when it would otherwise lie.
  const shownConnected = useRef<boolean | null>(openingView?.connected ?? null);
  const connected = query.data?.connected;
  useEffect(() => {
    if (connected === undefined) return;
    if (shownConnected.current !== null && shownConnected.current !== connected) router.refresh();
    shownConnected.current = connected;
  }, [connected, router]);

  const connection = useIntegrationConnection(meta.slug, 'own');
  const sharing = useIntegrationConnection(meta.slug, 'workspace');

  // The real logo is a deterministic static URL — instant, no network, and never
  // clobbered to the monogram when the async status read returns.
  const logoUrl = toolkitLogoUrl(meta.slug);

  return (
    <>
      <ModalHeader>
        <ModalTitle reveal="scroll">{meta.name}</ModalTitle>
      </ModalHeader>
      <ModalContent>
        <div className="flex min-h-0 flex-col gap-5 font-normal text-foreground">
          <IdentityHeader
            view={view}
            logoUrl={logoUrl}
            statusKnown={statusKnown}
            connection={connection}
          />
          <div className="[&_[role=tab]]:text-body scroll-fade-x min-w-0 overflow-x-auto overscroll-x-contain py-1 [--scroll-fade-size:24px]">
            <ModalSectionTabs
              value={section}
              options={SECTIONS}
              onChange={setSection}
              label="App detail sections"
              idPrefix="app-section"
            />
          </div>
          <ModalSectionPanel idPrefix="app-section" value={section}>
            {section === 'overview' ? (
              <OverviewSection meta={meta} connection={connection} />
            ) : null}
            {section === 'actions' ? <AppActionsSection slug={meta.slug} /> : null}
            {section === 'accounts' ? (
              <AccountsSection
                view={view}
                statusKnown={statusKnown}
                connection={connection}
                sharing={sharing}
              />
            ) : null}
          </ModalSectionPanel>
        </div>
      </ModalContent>
    </>
  );
}
