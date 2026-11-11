import 'server-only';
import { scheduleProvisioningRepair } from '@/features/workspaces/api/ensure-personal-workspace';
import { ensureRequestOrganization } from '@/features/workspaces/api/ensure-request-organization';
import { getWorkspaceName } from '@/features/workspaces/api/get-workspace-name';
import { listUserWorkspaces } from '@/features/workspaces/api/members';
import { findCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { getRequestSession } from '@/lib/request-session';
import type { ShellGateState, ShellWorkspace } from '../types';

export async function loadShellGate(requestHeaders: Headers): Promise<ShellGateState> {
  const session = await getRequestSession();
  if (!session) return { kind: 'signed_out' };
  const viewer = {
    userId: session.user.id,
    user: { name: session.user.name, email: session.user.email, image: session.user.image ?? null },
  };
  try {
    const organizationId = await ensureRequestOrganization();
    const workspaceName = await getWorkspaceName(organizationId);
    if (workspaceName === null)
      throw new AppError('WORKSPACE_NOT_FOUND', 'Shell workspace disappeared while opening', {
        organizationId,
      });
    const workspaces = await listUserWorkspaces({
      userId: viewer.userId,
      currentOrganizationId: organizationId,
    }).catch((error: unknown): ShellWorkspace[] => {
      // The switcher is secondary: a failed list still opens the app on the active workspace.
      captureException(error, { op: 'sidebar-workspaces', userId: viewer.userId });
      return [{ organizationId, name: workspaceName, isActive: true }];
    });
    return { kind: 'ready', ...viewer, organizationId, workspaceName, workspaces };
  } catch (error) {
    // The gate boundary keeps navigation available when provider setup fails.
    captureException(error, { feature: 'shell', op: 'workspace-gate', userId: viewer.userId });
    scheduleProvisioningRepair(requestHeaders);
    // The caller's live workspace only marks which switcher row is active.
    const workspaces = await findCaller(requestHeaders)
      .then((caller) =>
        listUserWorkspaces({
          userId: viewer.userId,
          currentOrganizationId: caller?.organizationId ?? '',
        }),
      )
      .catch((listError: unknown): ShellWorkspace[] => {
        // The failed gate must still render, so a second outage leaves the switcher empty.
        captureException(listError, { op: 'recovery-workspaces', userId: viewer.userId });
        return [];
      });
    return { kind: 'failed', ...viewer, workspaces };
  }
}
