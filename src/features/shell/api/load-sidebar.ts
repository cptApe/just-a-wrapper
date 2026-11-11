import { listWorkspaceSessionsPage } from '@/features/session-runtime';
import { dispatchSessionActions } from '@/features/tools/api/dispatch-session-actions';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { workspaceIdForOrganization } from '@/lib/workspace-identity';
import type { ShellWorkspace } from '../types';

export async function loadSidebar(input: {
  organizationId: string;
  userId: string;
  workspaces: ShellWorkspace[];
}) {
  // A sidebar read must not take down the app; the shell gate already checked active membership.
  try {
    // Runs on every refresh: only the row id is needed, never the billing summary or credit ledger.
    const workspaceId = await workspaceIdForOrganization(input.organizationId);
    if (workspaceId === null) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'Sidebar workspace is missing', {
        organizationId: input.organizationId,
      });
    }
    const page = await listWorkspaceSessionsPage({
      workspaceId,
      viewerId: input.userId,
      limit: 20,
      dispatchPendingToolCalls: dispatchSessionActions,
    });
    return { workspaces: input.workspaces, sessions: page.items, sessionsCursor: page.nextCursor };
  } catch (error) {
    captureException(error, { op: 'sidebar-data', userId: input.userId });
    return { workspaces: input.workspaces, sessions: [], sessionsCursor: null };
  }
}
