'use client';

import { IconCheckCircleSolid, IconLinkExternal01 } from '@/components/icons';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { SettingsSection } from '@/components/settings/settings-section';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ListRowGroup } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { type ToolkitMeta } from '@/lib/composio/toolkits';
import { type IntegrationConnection } from '../hooks/use-integration-connection';
import type { IntegrationView } from '../types';
import { IntegrationLogo } from './integration-logo';

// The one header anatomy shared by every integration: logo · name + status ·
// primary action. The action sits with the identity it operates on (the eye is
// already here), not in a separate footer row — and never in the modal's own
// chrome header beside ✕. Status reads at a glance for
// non-technical users; a connected app shows the solid green check. Until the
// first status read answers, the status line says so and the action area holds
// a quiet inline spinner — a subtle pending mark, never a seconds-long skeleton
// pill, and right-aligned so the name + logo never shift when the button lands.
export function IdentityHeader({
  view,
  logoUrl,
  statusKnown,
  connection,
}: {
  view: IntegrationView;
  logoUrl: string | null;
  statusKnown: boolean;
  connection: IntegrationConnection;
}) {
  return (
    <div className="flex items-center gap-3">
      <IntegrationLogo logoUrl={logoUrl} name={view.name} slug={view.slug} size={44} />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="truncate text-title-section font-semibold text-foreground">{view.name}</h2>
        <p className="flex items-center gap-1.5 text-meta text-muted-foreground">
          {statusKnown && view.connected && connection.phase !== 'disconnecting' ? (
            <IconCheckCircleSolid aria-hidden="true" className="size-4 text-success-strong" />
          ) : null}
          {!statusKnown
            ? 'Checking the connection…'
            : view.error
              ? 'Couldn’t check the connection'
              : view.connected
                ? connection.phase === 'disconnecting'
                  ? 'Disconnecting…'
                  : view.ownConnected
                    ? 'Connected'
                    : 'Shared account'
                : connection.phase === 'connecting'
                  ? 'Connecting…'
                  : 'Not connected'}
        </p>
      </div>
      {statusKnown ? (
        <ConnectionAction view={view} connection={connection} />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center" aria-hidden="true">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

/** Connect / disconnect / retry — beside the name+status it operates on. */
function ConnectionAction({
  view,
  connection,
}: {
  view: IntegrationView;
  connection: IntegrationConnection;
}) {
  const busy = connection.phase === 'connecting' || connection.phase === 'disconnecting';
  if (view.error) {
    return (
      <Button
        className="text-body"
        variant="secondary"
        onClick={connection.recheck}
        disabled={busy}
      >
        {connection.phase === 'checking' ? 'Checking…' : 'Retry'}
      </Button>
    );
  }
  if (view.ownConnected) {
    return (
      <Button
        className="text-body"
        variant="secondary"
        onClick={connection.disconnect}
        disabled={busy}
        data-testid={`disconnect-${view.slug}`}
      >
        {connection.phase === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
      </Button>
    );
  }
  return (
    <Button
      className="text-body"
      onClick={connection.connect}
      disabled={busy}
      data-testid={`connect-${view.slug}`}
    >
      {connection.phase === 'connecting' ? 'Starting…' : 'Connect'}
    </Button>
  );
}

// Overview copy is static catalog data, so the panel renders in one paint.
// Examples are copied, not launched: the home composer takes no prefilled draft.
export function OverviewSection({
  meta,
  connection,
}: {
  meta: ToolkitMeta;
  connection: IntegrationConnection;
}) {
  return (
    <div className="flex flex-col gap-6">
      {connection.signInPending ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-alpha-6 px-4 py-3">
          <p className="flex-1 text-meta text-muted-foreground">
            Finish sign-in in the opened tab, then check the connection.
          </p>
          <Button
            className="text-body"
            variant="secondary"
            size="sm"
            onClick={connection.recheck}
            disabled={connection.phase === 'checking'}
          >
            {connection.phase === 'checking' ? 'Checking…' : 'Check connection'}
          </Button>
        </div>
      ) : null}
      {connection.loadFailure ? (
        <ErrorState
          title={connection.loadFailure.title}
          message={connection.loadFailure.body}
          onRetry={connection.reload}
          className="py-6"
        />
      ) : null}

      <p className="max-w-[65ch] text-pretty text-body font-normal text-foreground">
        {meta.summary}
      </p>

      <section aria-labelledby={`try-asking-${meta.slug}`} className="flex flex-col gap-3">
        <h3
          id={`try-asking-${meta.slug}`}
          className="text-title-section font-semibold text-foreground"
        >
          Try asking
        </h3>
        <ListRowGroup divide>
          {meta.examples.map((example) => (
            <li key={example} className="flex min-h-12 items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-pretty text-body font-normal text-foreground">
                {example}
              </span>
              <CopyButton
                label=""
                accessibleLabel={`Copy “${example}”`}
                op="integrations.copy-example"
                context={{ slug: meta.slug }}
                text={example}
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:bg-alpha-8 hover:text-foreground"
              />
            </li>
          ))}
        </ListRowGroup>
      </section>

      <div className="flex flex-col gap-1.5">
        <a
          href={meta.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-meta font-normal text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <IconLinkExternal01 className="size-3.5" aria-hidden />
          {meta.name} website
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        {/* Every catalog app signs in through the vendor's own OAuth screen. */}
        <p className="max-w-[65ch] text-pretty text-meta font-normal text-muted-foreground">
          You sign in on the {meta.name} site to connect, and you can revoke access there any time.
        </p>
      </div>
    </div>
  );
}

export function AccountsSection({
  view,
  statusKnown,
  connection,
  sharing,
}: {
  view: IntegrationView;
  statusKnown: boolean;
  connection: IntegrationConnection;
  sharing: IntegrationConnection;
}) {
  if (!statusKnown) {
    return (
      <section aria-label="Accounts">
        <Skeleton className="h-28 rounded-md" aria-hidden="true" />
      </section>
    );
  }
  return (
    <SettingsSection
      aria-label="Accounts"
      description="Your agent uses your own account first, then the workspace one."
    >
      <SettingsDetailRow label="Your account" value={ownAccountStatus(view, connection)} />
      <WorkspaceAccount view={view} sharing={sharing} />
    </SettingsSection>
  );
}

function ownAccountStatus(view: IntegrationView, connection: IntegrationConnection): string {
  if (connection.phase === 'disconnecting') return 'Disconnecting…';
  if (view.error) return 'Couldn’t check';
  return view.ownConnected ? 'In use' : 'Not connected';
}

function workspaceAccountStatus(view: IntegrationView): string {
  switch (view.shared.status) {
    case 'active':
      // A member's own account always wins, so the shared one is in use only without it.
      return view.ownConnected
        ? `Shared by ${view.shared.sharedBy}`
        : `Shared by ${view.shared.sharedBy}, in use`;
    case 'needs-reconnect':
      return 'Needs reconnecting';
    case 'pending':
      return 'Waiting for sign-in';
    case 'none':
      return 'Not shared';
  }
}

function WorkspaceAccount({
  view,
  sharing,
}: {
  view: IntegrationView;
  sharing: IntegrationConnection;
}) {
  if (view.shared.status === 'none' && !view.canShare) return null;
  const busy = sharing.phase === 'connecting' || sharing.phase === 'disconnecting';
  const canStop = view.shared.status === 'active' || view.shared.status === 'needs-reconnect';
  const action = !view.canShare ? undefined : canStop ? (
    <Button
      className="text-body"
      variant="secondary"
      size="sm"
      onClick={sharing.disconnect}
      disabled={busy}
    >
      {sharing.phase === 'disconnecting' ? 'Stopping…' : 'Stop sharing'}
    </Button>
  ) : (
    <Button
      className="text-body"
      variant="secondary"
      size="sm"
      onClick={sharing.connect}
      disabled={busy}
      data-testid={`share-${view.slug}`}
    >
      {sharing.phase === 'connecting' ? 'Starting…' : 'Share'}
    </Button>
  );
  return (
    <SettingsDetailRow
      label="Workspace account"
      value={
        sharing.signInPending ? 'Finish sign-in in the opened tab' : workspaceAccountStatus(view)
      }
      action={
        sharing.signInPending ? (
          <Button
            className="text-body"
            variant="secondary"
            size="sm"
            onClick={sharing.recheck}
            disabled={sharing.phase === 'checking'}
          >
            {sharing.phase === 'checking' ? 'Checking…' : 'Check'}
          </Button>
        ) : (
          action
        )
      }
    />
  );
}

export function OverlayNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <p className="text-body font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-meta text-muted-foreground">{body}</p>
    </div>
  );
}
