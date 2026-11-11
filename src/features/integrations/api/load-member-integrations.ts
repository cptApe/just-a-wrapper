import 'server-only';
import { ENABLED_TOOLKITS, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { captureException } from '@/lib/observability';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';
import { type ToolkitConnectionEntry, toolkitConnections } from '../composio/connect';
import { signMemberToken } from '../jwt';
import type { IntegrationsResult } from '../types';
import {
  errNotice,
  hasLiveShare,
  type IntegrationMember,
  NOT_CONFIGURED,
  proxyUrl,
  requireProxyKeys,
  toView,
} from './connection-context';
import { recordConnectionStates } from './connection-transitions';
import { readSharedConnections, type SharedConnections } from './shared-connections';
import { clearToolRouterCache } from './tool-router-transitions';

// One member-scoped proxy call reads all enabled toolkits. Transport failures
// produce a retryable notice; per-toolkit failures remain on their own cards.
export async function loadMemberIntegrations(
  actor: IntegrationMember,
): Promise<IntegrationsResult> {
  const keys = requireProxyKeys();
  if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
  const { composioUserId } = actor;

  const observedAt = new Date();
  let connections: Map<string, ToolkitConnectionEntry>;
  let shared: SharedConnections;
  try {
    shared = await readSharedConnections(actor, keys.apiKey);
    const jwt = await signMemberToken(composioUserId, keys.secret, '5m');
    const unshared = ENABLED_TOOLKITS.filter((meta) => !hasLiveShare(shared, meta.slug));
    connections =
      unshared.length === 0
        ? new Map()
        : await toolkitConnections(
            await proxyUrl(),
            jwt,
            unshared.map((meta) => meta.slug),
          );
  } catch (error) {
    captureException(error, { op: 'list-connections', composioUserId });
    return { status: 'notice', notice: errNotice(error) };
  }

  const integrations = ENABLED_TOOLKITS.map((meta) =>
    toView(
      meta,
      connections.get(meta.slug) ?? {
        status: 'error',
        message: 'No connection result returned',
      },
      toolkitLogoUrl(meta.slug),
      { canShare: actor.canShare, shared },
    ),
  );
  const workspaceId = await workspaceIdForOrganization(actor.organizationId);
  if (workspaceId) {
    const newlyConnected = await recordConnectionStates({
      observedAt,
      workspaceId,
      userId: actor.userId,
      connections: integrations
        .filter((view) => view.error === null)
        .map((view) => ({ toolkit: view.slug, connected: view.ownConnected })),
    });
    // A session pinned to the shared account must give way to the new own account.
    if (newlyConnected.some((toolkit) => hasLiveShare(shared, toolkit)))
      await clearToolRouterCache({ kind: 'member', memberId: composioUserId });
  }
  return { status: 'ok', integrations };
}
