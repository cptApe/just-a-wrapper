// Shared types for the integrations surface. Kept out of the 'use server'
// actions files (which may only export async server actions) so the client
// components and the actions can share one contract.

export type TesterNotice = { tone: 'warn' | 'error'; title: string; body: string };

export type VaultHealth =
  | { status: 'healthy' | 'unprovisioned' }
  | { status: 'broken'; reason: 'credential-missing' }
  | { status: 'unknown'; reason: 'proxy-unreachable' | 'check-failed' };

export type ConnectResult =
  | { status: 'active' }
  | { status: 'redirect'; redirectUrl: string }
  | { status: 'notice'; notice: TesterNotice };

// The workspace's shared account for a toolkit, as members see it. It names the
// person who shared it and never carries the account id or any credential.
export type SharedConnectionView =
  | { status: 'none' | 'pending' }
  | { status: 'active' | 'needs-reconnect'; sharedBy: string };

// One toolkit row on the page. `connected` means the agent can use the app, through
// the member's own account or the workspace's; `ownConnected` is the member's own.
// `connectUrl` is the session-minted OAuth
// link, present only when the member is NOT connected (the same call that
// reports the status also hands back the link, so Connect needs no extra mint).
export type IntegrationView = {
  slug: string;
  name: string;
  blurb: string;
  // Static public CDN logo URL. Null or a failed image request falls back
  // to a monogram in the card.
  logoUrl: string | null;
  shared: SharedConnectionView;
  canShare: boolean;
} & (
  | { connected: true; ownConnected: boolean; connectUrl: null; error: null }
  | { connected: false; ownConnected: false; connectUrl: string | null; error: null }
  | { connected: false; ownConnected: false; connectUrl: null; error: string }
);

// Initial page payload + per-toolkit refresh result. `notice` covers the
// degraded states (proxy not configured, upstream error) so the section renders
// a banner instead of blanking — the four-state discipline.
export type IntegrationsResult =
  | { status: 'ok'; integrations: IntegrationView[] }
  | { status: 'notice'; notice: TesterNotice };

export type IntegrationStatusResult =
  | { status: 'ok'; view: IntegrationView }
  | { status: 'notice'; notice: TesterNotice };

export type DisconnectResult =
  | { status: 'ok'; removed: number }
  | { status: 'notice'; notice: TesterNotice };

// One action row in the integration detail modal: the human task phrase
// ("Draft replies") plus the catalog's own description sentence. The raw slug
// is carried for permission writes and read/write classification only — it is
// NEVER rendered (non-technical users; raw SCREAMING_SNAKE ids are developer
// vocabulary). `curated` marks the hand-curated set, which leads the list.
export type IntegrationActionView = {
  slug: string;
  phrase: string;
  description: string;
  curated: boolean;
  access: 'read' | 'write';
};

export type IntegrationActionsResult =
  | {
      status: 'ok';
      actions: IntegrationActionView[];
      /** Catalog total — greater than actions.length when the page cap was hit. */
      totalCount: number;
    }
  | { status: 'notice'; notice: TesterNotice };
