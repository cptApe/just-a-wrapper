import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { member, workspace, workspaceMember, workspaceNotDeleted } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { type ToolkitMeta, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities, composioCapability } from '@/lib/runtime-capabilities';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { type ToolkitConnectionEntry, toolkitConnection } from '../composio/connect';
import { signMemberToken } from '../jwt';
import type { IntegrationView, SharedConnectionView, TesterNotice } from '../types';
import { NO_SHARES, readSharedConnections, type SharedConnections } from './shared-connections';

export function errNotice(error: unknown): TesterNotice {
  const code = error instanceof AppError ? error.code : 'UNEXPECTED';
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { tone: 'error', title: `Error · ${code}`, body: message };
}

export const NOT_CONFIGURED: TesterNotice = {
  tone: 'warn',
  title: 'Connected apps are off',
  body: CAPABILITY_OFF_MESSAGES.connectedApps,
};

// The JWT secret signs the per-member token; the Composio key authenticates the upstream mint.
export function requireProxyKeys(): { secret: string; apiKey: string } | null {
  const { connectedApps } = capabilities;
  return connectedApps.kind === 'composio'
    ? { secret: connectedApps.jwtSecret, apiKey: connectedApps.apiKey }
    : null;
}

// The proxy URL must match the endpoint installed in member vault credentials.
export async function proxyUrl(): Promise<string> {
  return composioCapability().proxyUrl;
}

// Identity reads authorize the current membership without running provider recovery.
export async function currentMember(): Promise<IntegrationMember> {
  const { organizationId, userId } = await resolveCaller(await headers());
  return resolveIntegrationMember({ organizationId, userId });
}

export async function resolveIntegrationMember(input: { organizationId: string; userId: string }) {
  const { organizationId, userId } = input;
  const row = (
    await db
      .select({ composioUserId: workspaceMember.composioUserId, role: member.role })
      .from(workspaceMember)
      .innerJoin(
        member,
        and(
          eq(member.organizationId, workspaceMember.organizationId),
          eq(member.userId, workspaceMember.userId),
        ),
      )
      .innerJoin(
        workspace,
        and(eq(workspace.organizationId, workspaceMember.organizationId), workspaceNotDeleted),
      )
      .where(
        and(eq(workspaceMember.organizationId, organizationId), eq(workspaceMember.userId, userId)),
      )
      .limit(1)
  ).at(0);
  if (!row) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'no workspace_member for caller', {
      userId,
      organizationId,
    });
  }
  return {
    organizationId,
    userId,
    composioUserId: row.composioUserId,
    canShare: roleIsAtLeast(row.role, 'admin'),
  };
}

export type IntegrationMember = Awaited<ReturnType<typeof resolveIntegrationMember>>;

const NO_SHARED_CONNECTION: SharedConnectionView = { status: 'none' };
// A live share pins the session, so Composio's status read would describe the
// shared account. Own-versus-shared comes from the account list instead.
export function hasLiveShare(shared: SharedConnections, toolkit: string): boolean {
  const status = shared.connections.get(toolkit)?.status;
  return status === 'active' || status === 'needs-reconnect';
}

// Read one toolkit's live status for the member, via the proxy round-trip. On
// upstream failure returns a view carrying `error` rather than throwing, so one
// toolkit can't blank the whole page. Logos use the static catalog URL.
export async function readToolkit(
  meta: ToolkitMeta,
  actor: IntegrationMember,
  keys: { secret: string; apiKey: string },
): Promise<IntegrationView> {
  const logoUrl = toolkitLogoUrl(meta.slug);
  try {
    const shared = await readSharedConnections(actor, keys.apiKey);
    if (hasLiveShare(shared, meta.slug))
      return toView(meta, { status: 'active' }, logoUrl, { canShare: actor.canShare, shared });
    const jwt = await signMemberToken(actor.composioUserId, keys.secret, '5m');
    const conn = await toolkitConnection(await proxyUrl(), jwt, meta.slug);
    return toView(meta, conn, logoUrl, { canShare: actor.canShare, shared });
  } catch (error) {
    captureException(error, {
      op: 'read-toolkit',
      toolkitSlug: meta.slug,
      composioUserId: actor.composioUserId,
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return toView(meta, { status: 'error', message }, logoUrl, {
      canShare: actor.canShare,
      shared: NO_SHARES,
    });
  }
}

// Fold one toolkit's connection entry + its (decorative, never-throwing) logo into
// the row the page renders. An `error` entry surfaces the inline "couldn't check"
// state rather than a wrong connected/disconnected badge.
export function toView(
  meta: ToolkitMeta,
  entry: ToolkitConnectionEntry,
  logoUrl: string | null,
  access: { canShare: boolean; shared: SharedConnections },
): IntegrationView {
  const shared = access.shared.connections.get(meta.slug) ?? NO_SHARED_CONNECTION;
  const base = {
    slug: meta.slug,
    name: meta.name,
    blurb: meta.blurb,
    logoUrl,
    shared,
    canShare: access.canShare,
  };
  if (hasLiveShare(access.shared, meta.slug)) {
    const ownConnected = access.shared.ownActiveToolkits.has(meta.slug.toLowerCase());
    return ownConnected || shared.status === 'active'
      ? { ...base, connected: true, ownConnected, connectUrl: null, error: null }
      : { ...base, connected: false, ownConnected: false, connectUrl: null, error: null };
  }
  if (entry.status === 'active') {
    return { ...base, connected: true, ownConnected: true, connectUrl: null, error: null };
  }
  if (entry.status === 'pending') {
    return {
      ...base,
      connected: false,
      ownConnected: false,
      connectUrl: entry.redirectUrl,
      error: null,
    };
  }
  return { ...base, connected: false, ownConnected: false, connectUrl: null, error: entry.message };
}
