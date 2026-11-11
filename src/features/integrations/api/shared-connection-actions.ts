'use server';

import { headers } from 'next/headers';
import { resolveCaller } from '@/lib/caller';
import { toolkitMetadata } from '@/lib/composio/toolkits';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';
import type { ConnectResult, DisconnectResult, TesterNotice } from '../types';
import { errNotice, NOT_CONFIGURED, requireProxyKeys } from './connection-context';
import { startWorkspaceShare, stopWorkspaceShare } from './shared-connections';

const ALREADY_SHARED: TesterNotice = {
  tone: 'warn',
  title: 'Already shared',
  body: 'This app already has a workspace account. Stop sharing it before connecting another one.',
};

async function adminWorkspace() {
  const admin = await resolveCaller(await headers(), {
    atLeast: 'admin',
    refusal: 'Workspace administration requires owner or admin',
  });
  const workspaceId = await workspaceIdForOrganization(admin.organizationId);
  if (workspaceId === null)
    throw new AppError('WORKSPACE_NOT_FOUND', 'Sharing requires a live workspace', {
      organizationId: admin.organizationId,
    });
  return { ...admin, workspaceId };
}

function unknownToolkit(slug: string): { status: 'notice'; notice: TesterNotice } {
  return {
    status: 'notice',
    notice: { tone: 'error', title: 'Unknown toolkit', body: `No such toolkit: ${slug}` },
  };
}

/** Owner or admin: start the sign-in for the account the workspace will share. */
export async function shareIntegration(slug: string): Promise<ConnectResult> {
  return withRequestContext(
    { route: 'plugins/connectors/share', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) return unknownToolkit(slug);
      const keys = requireProxyKeys();
      if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
      try {
        const admin = await adminWorkspace();
        const started = await startWorkspaceShare(
          {
            workspaceId: admin.workspaceId,
            organizationId: admin.organizationId,
            toolkit: meta.slug,
            sharedByUserId: admin.userId,
          },
          keys.apiKey,
        );
        return started.status === 'claimed'
          ? { status: 'redirect', redirectUrl: started.redirectUrl }
          : { status: 'notice', notice: ALREADY_SHARED };
      } catch (error) {
        captureException(error, { op: 'share-integration', toolkitSlug: slug });
        return { status: 'notice', notice: errNotice(error) };
      }
    },
  );
}

/** Owner or admin: stop sharing. Deleting the account is what cuts off every member. */
export async function stopSharingIntegration(slug: string): Promise<DisconnectResult> {
  return withRequestContext(
    { route: 'plugins/connectors/stop-sharing', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) return unknownToolkit(slug);
      const keys = requireProxyKeys();
      if (!keys) return { status: 'notice', notice: NOT_CONFIGURED };
      try {
        const admin = await adminWorkspace();
        await stopWorkspaceShare(
          { workspaceId: admin.workspaceId, toolkit: meta.slug },
          keys.apiKey,
        );
        return { status: 'ok', removed: 1 };
      } catch (error) {
        captureException(error, { op: 'stop-sharing-integration', toolkitSlug: slug });
        return { status: 'notice', notice: errNotice(error) };
      }
    },
  );
}
