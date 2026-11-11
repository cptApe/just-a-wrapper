import 'server-only';
import { deleteWorkspaceBrowserContexts } from '@/features/tools/api/browser-contexts';
import { releaseWorkspaceBrowsers } from '@/features/tools/api/browser-timeout';
import { captureException } from '@/lib/observability';

// Deletion takes effect before remote cleanup. Retain the context identity when cleanup fails.
export async function cleanupDeletedWorkspaceBrowsers(workspaceId: string): Promise<void> {
  try {
    await releaseWorkspaceBrowsers(workspaceId);
  } catch (cause) {
    captureException(cause, {
      feature: 'tooling',
      op: 'deleted-workspace-browser-cleanup',
      workspaceId,
    });
  }
  try {
    await deleteWorkspaceBrowserContexts(workspaceId);
  } catch (cause) {
    captureException(cause, {
      feature: 'tooling',
      op: 'deleted-workspace-context-cleanup',
      workspaceId,
    });
  }
}
