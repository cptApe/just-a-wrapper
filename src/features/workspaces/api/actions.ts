'use server';

import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { type ActionState, runAction } from '@/lib/action-state';
import { assertExpectedOrganization } from '@/lib/assert-expected-organization';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { workspaceActionBoundary } from '../lib/workspace-error-copy';
import { createWorkspace } from './create-workspace';
import { renameWorkspace } from './rename-workspace';

// Server action for the /settings/workspace name form. The write itself goes
// through `renameWorkspace`, the one rename path.

const nameSchema = z.string().trim().min(1, 'name is required').max(100, 'name too long');

export async function updateWorkspaceNameAction(
  rawName: string,
  expectedOrganizationId: string,
): Promise<ActionState<{ name: string }>> {
  return runAction(workspaceActionBoundary('settings-workspace-rename', 'rename'), async () => {
    const parsed = nameSchema.safeParse(rawName);
    if (!parsed.success) {
      throw new AppError('TOOL_INPUT_INVALID', 'workspace name failed validation', {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const { organizationId } = await resolveCaller(await headers(), {
      atLeast: 'admin',
      refusal: 'Workspace administration requires owner or admin',
    });
    assertExpectedOrganization(organizationId, expectedOrganizationId);
    const ws = (
      await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(eq(workspace.organizationId, organizationId), workspaceNotDeleted))
        .limit(1)
    ).at(0);
    if (!ws) {
      throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace for active organization', {
        organizationId,
      });
    }

    const renamed = await renameWorkspace({ workspaceId: ws.id, name: parsed.data });
    return { name: renamed.name };
  });
}

// Server action behind the sidebar create-workspace dialog. Validation shares
// the rename bounds (a workspace name is a workspace name); the heavy lifting
// — slug derivation, Better Auth org create, the full provisioning chain, and
// activating the new org — lives in `createWorkspace`. On `ok` the new org is
// already the session's active organization, so the client just lands on /app
// and refreshes.
export async function createWorkspaceAction(
  rawName: string,
): Promise<ActionState<{ organizationId: string }>> {
  return runAction(workspaceActionBoundary('workspace-create', 'create'), async () => {
    const parsed = nameSchema.safeParse(rawName);
    if (!parsed.success) {
      throw new AppError('TOOL_INPUT_INVALID', 'workspace name failed validation', {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const { organizationId } = await createWorkspace({
      name: parsed.data,
      headers: await headers(),
    });
    return { organizationId };
  });
}
