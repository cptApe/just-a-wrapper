'use server';

import { captureEvent } from '@/lib/analytics';
import { toolkitMetadata } from '@/lib/composio/toolkits';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';
import { toolkitConnection } from '../composio/connect';
import { disconnectToolkitAccounts } from '../composio/disconnect';
import { signMemberToken } from '../jwt';
import type {
  ConnectResult,
  DisconnectResult,
  IntegrationStatusResult,
  IntegrationsResult,
  VaultHealth,
} from '../types';
import {
  currentMember,
  errNotice,
  hasLiveShare,
  NOT_CONFIGURED,
  proxyUrl,
  readToolkit,
  requireProxyKeys,
} from './connection-context';
import { ensureConnectedAppToolDefaults } from './connection-tool-defaults';
import {
  beginConnectionDisconnect,
  finishConnectionDisconnect,
  recordConnectionState,
} from './connection-transitions';
import { loadMemberIntegrations } from './load-member-integrations';
import { ensureMemberVault } from './provision-vault';
import { ownConnectLink, readSharedConnections } from './shared-connections';
import { clearToolRouterCache } from './tool-router-transitions';
import { checkMemberVaultHealth } from './vault-health';

export async function getIntegrations(): Promise<IntegrationsResult> {
  return withRequestContext(
    { route: 'plugins/connectors/list', feature: 'integrations' },
    async () => {
      const actor = await currentMember();
      return loadMemberIntegrations(actor);
    },
  );
}

/** Re-read one toolkit's status — backs the "Check connection" / post-OAuth refresh. */
export async function refreshIntegration(slug: string): Promise<IntegrationStatusResult> {
  return withRequestContext(
    { route: 'plugins/connectors/refresh', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) {
        return {
          status: 'notice',
          notice: { tone: 'error', title: 'Unknown toolkit', body: `No such toolkit: ${slug}` },
        };
      }
      const keys = requireProxyKeys();
      if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
      const actor = await currentMember();
      const { composioUserId, userId, organizationId } = actor;
      const observedAt = new Date();
      const view = await readToolkit(meta, actor, keys);
      // The app never sees Composio's OAuth callback, so the connect edge is the
      // status read that finds a toolkit connected when the stored row says it
      // was not (recordConnectionState keeps that row).
      const workspaceId = await workspaceIdForOrganization(organizationId);
      if (workspaceId && view.error === null) {
        const edge = await recordConnectionState({
          observedAt,
          workspaceId,
          userId,
          toolkit: meta.slug,
          connected: view.ownConnected,
        });
        if (edge === 'connected') {
          captureEvent('tool:connect', { toolkit_slug: meta.slug }, { userId, workspaceId });
          // A session pinned to the shared account must give way to the new own account.
          if (view.shared.status !== 'none')
            await clearToolRouterCache({ kind: 'member', memberId: composioUserId });
        }
      }
      if (view.connected) {
        await ensureConnectedAppToolDefaults({
          organizationId,
          userId,
          toolkit: meta.slug,
          apiKey: keys.apiKey,
        });
      }
      return { status: 'ok', view };
    },
  );
}

/**
 * Mint a fresh OAuth connect link for a toolkit via the member's own Tool Router
 * session (COMPOSIO_MANAGE_CONNECTIONS through the proxy). Returns `active` when
 * the session already sees a usable connection, or `redirect` with the link.
 */
export async function connectIntegration(slug: string): Promise<ConnectResult> {
  return withRequestContext(
    { route: 'plugins/connectors/connect', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) {
        return {
          status: 'notice',
          notice: { tone: 'error', title: 'Unknown toolkit', body: `No such toolkit: ${slug}` },
        };
      }
      const keys = requireProxyKeys();
      if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
      try {
        const actor = await currentMember();
        const { composioUserId, organizationId, userId } = actor;
        // A pinned session reports the shared account as connected, so only a fresh
        // unpinned session can open the sign-in for the member's own account.
        const shared = await readSharedConnections(actor, keys.apiKey);
        if (hasLiveShare(shared, meta.slug) && !shared.ownActiveToolkits.has(meta.slug))
          return {
            status: 'redirect',
            redirectUrl: await ownConnectLink(composioUserId, meta.slug, keys.apiKey),
          };
        const jwt = await signMemberToken(composioUserId, keys.secret, '5m');
        const observedAt = new Date();
        const conn = await toolkitConnection(await proxyUrl(), jwt, meta.slug);
        if (conn.status === 'active') {
          const workspaceId = await workspaceIdForOrganization(organizationId);
          if (workspaceId)
            await recordConnectionState({
              observedAt,
              workspaceId,
              userId,
              toolkit: meta.slug,
              connected: true,
            });
          await ensureConnectedAppToolDefaults({
            organizationId,
            userId,
            toolkit: meta.slug,
            apiKey: keys.apiKey,
          });
        }
        return conn.status === 'active'
          ? { status: 'active' }
          : { status: 'redirect', redirectUrl: conn.redirectUrl };
      } catch (error) {
        captureException(error, { op: 'connect-integration', toolkitSlug: slug });
        return { status: 'notice', notice: errNotice(error) };
      }
    },
  );
}

/**
 * Disconnect a toolkit: delete the current member's connected account(s) for it
 * (Composio REST, scoped to the caller's own composio_user_id). Idempotent —
 * removing nothing is success, not an error.
 */
export async function disconnectIntegration(slug: string): Promise<DisconnectResult> {
  return withRequestContext(
    { route: 'plugins/connectors/disconnect', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) {
        return {
          status: 'notice',
          notice: { tone: 'error', title: 'Unknown toolkit', body: `No such toolkit: ${slug}` },
        };
      }
      const keys = requireProxyKeys();
      if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
      try {
        const { composioUserId, userId, organizationId } = await currentMember();
        const workspaceId = await workspaceIdForOrganization(organizationId);
        if (workspaceId === null)
          throw new AppError('WORKSPACE_NOT_FOUND', 'Disconnect requires a live workspace', {
            organizationId,
          });
        const claimedAt = await beginConnectionDisconnect({
          workspaceId,
          userId,
          toolkit: meta.slug,
        });
        if (claimedAt === null)
          throw new AppError(
            'CONFLICT',
            'Connection disconnect is already in progress or membership was revoked',
            { workspaceId, userId, toolkit: meta.slug },
          );
        const { removed } = await disconnectToolkitAccounts(composioUserId, keys.apiKey, meta.slug);
        // The next session decides again whether the workspace's account applies.
        await clearToolRouterCache({ kind: 'member', memberId: composioUserId });
        if (
          !(await finishConnectionDisconnect({
            workspaceId,
            userId,
            toolkit: meta.slug,
            claimedAt,
          }))
        )
          throw new AppError('CONFLICT', 'Connection disconnect lost its claim', {
            workspaceId,
            userId,
            toolkit: meta.slug,
          });
        return { status: 'ok', removed };
      } catch (error) {
        captureException(error, { op: 'disconnect-integration', toolkitSlug: slug });
        return { status: 'notice', notice: errNotice(error) };
      }
    },
  );
}

export async function reconnectMemberVault(): Promise<VaultHealth> {
  return withRequestContext(
    { route: 'plugins/connectors/reconnect-vault', feature: 'integrations' },
    async () => {
      const member = await currentMember();
      await ensureMemberVault({
        organizationId: member.organizationId,
        userId: member.userId,
        refreshCredential: true,
      });
      return checkMemberVaultHealth(member);
    },
  );
}

/** Independent read: slow health checks never hold the catalog or connections. */
export async function getMemberVaultHealth(): Promise<VaultHealth> {
  return withRequestContext({ route: 'tools/vault-health', feature: 'integrations' }, async () => {
    const member = await currentMember();
    try {
      return await checkMemberVaultHealth(member);
    } catch (error) {
      captureException(error, {
        op: 'check-member-vault-health',
        composioUserId: member.composioUserId,
      });
      return { status: 'unknown', reason: 'check-failed' };
    }
  });
}
