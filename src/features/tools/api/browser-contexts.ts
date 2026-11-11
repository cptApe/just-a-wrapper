import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceMember } from '@/db/schema';
import { IntegrationError, ToolError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { browserbaseCapability } from '@/lib/runtime-capabilities';
import { type BrowserContextStore, ensureBrowserContext } from '../lib/browser-context';
import { createBrowserbaseContext, deleteBrowserbaseContext } from './browserbase-client';

// Sign-ins belong to the task creator; concurrent first opens converge on one member context.
export async function ensureMemberBrowserContext(
  workspaceId: string,
  userId: string,
): Promise<string> {
  await reconcileBrowserContextCandidates(workspaceId);
  const store = memberContextStore(workspaceId, userId);
  const contextId = await ensureBrowserContext(store);
  if (!contextId) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Could not save the member browser context', {
      workspaceId,
    });
  }
  return contextId;
}

function memberContextStore(workspaceId: string, userId: string): BrowserContextStore {
  const credentials = browserbaseCapability();
  const membership = and(
    eq(workspaceMember.userId, userId),
    eq(
      workspaceMember.organizationId,
      db
        .select({ id: workspace.organizationId })
        .from(workspace)
        .where(and(eq(workspace.id, workspaceId), isNull(workspace.deletedAt))),
    ),
  );
  return {
    async read() {
      const row = (
        await db
          .select({ contextId: workspaceMember.browserbaseContextId })
          .from(workspaceMember)
          .where(membership)
          .limit(1)
      ).at(0);
      if (!row) throw new ToolError('WORKSPACE_NOT_FOUND', 'Workspace not found', { workspaceId });
      return row.contextId;
    },
    create: () => createBrowserbaseContext(credentials),
    async discard(contextId) {
      await db
        .update(workspace)
        .set({
          browserContextCleanupIds: sql`array_append(${workspace.browserContextCleanupIds}, ${contextId})`,
        })
        .where(eq(workspace.id, workspaceId));
      await reconcileBrowserContextCandidates(workspaceId);
    },
    async claim(contextId) {
      const claimed = (
        await db
          .update(workspaceMember)
          .set({ browserbaseContextId: contextId })
          .where(and(membership, isNull(workspaceMember.browserbaseContextId)))
          .returning({ contextId: workspaceMember.browserbaseContextId })
      ).at(0);
      if (claimed?.contextId) {
        return claimed.contextId;
      }
      const winner = (
        await db
          .select({ contextId: workspaceMember.browserbaseContextId })
          .from(workspaceMember)
          .where(membership)
          .limit(1)
      ).at(0);
      return winner?.contextId ?? null;
    },
  };
}

export async function deleteWorkspaceBrowserContexts(workspaceId: string): Promise<void> {
  const organization = db
    .select({ id: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  const members = await db
    .select()
    .from(workspaceMember)
    .where(eq(workspaceMember.organizationId, organization));
  for (const member of members) {
    if (member.browserbaseContextId === null) continue;
    await db
      .update(workspace)
      .set({
        browserContextCleanupIds: sql`array_append(${workspace.browserContextCleanupIds}, ${member.browserbaseContextId})`,
      })
      .where(eq(workspace.id, workspaceId));
    await db
      .update(workspaceMember)
      .set({ browserbaseContextId: null })
      .where(
        and(
          eq(workspaceMember.organizationId, member.organizationId),
          eq(workspaceMember.userId, member.userId),
          eq(workspaceMember.browserbaseContextId, member.browserbaseContextId),
        ),
      );
  }
  const pending = await reconcileBrowserContextCandidates(workspaceId);
  if (pending > 0)
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Browser contexts remain pending deletion', {
      workspaceId,
      pending,
    });
}

async function removeContextCandidate(workspaceId: string, contextId: string): Promise<void> {
  await db
    .update(workspace)
    .set({
      browserContextCleanupIds: sql`array_remove(${workspace.browserContextCleanupIds}, ${contextId})`,
    })
    .where(eq(workspace.id, workspaceId));
}

// Failed deletion retains a durable candidate for the next open or workspace cleanup.
export async function reconcileBrowserContextCandidates(workspaceId: string): Promise<number> {
  const row = (
    await db
      .select({
        candidates: workspace.browserContextCleanupIds,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
  ).at(0);
  if (!row || row.candidates.length === 0) return 0;
  const credentials = browserbaseCapability();
  let pending = 0;
  for (const contextId of row.candidates) {
    try {
      await deleteBrowserbaseContext(credentials.apiKey, contextId);
    } catch (error) {
      captureException(error, {
        feature: 'tooling',
        op: 'browser-context-cleanup-pending',
        workspaceId,
        contextId,
      });
      pending += 1;
      continue;
    }
    await removeContextCandidate(workspaceId, contextId);
  }
  return pending;
}
