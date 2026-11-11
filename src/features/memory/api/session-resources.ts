import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { member, workspace, workspaceMember } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { captureException } from '@/lib/observability';
import { roleIsAtLeast } from '@/lib/workspace-role';
import {
  appendMemoryFileListing,
  USER_STORE_INSTRUCTIONS,
  WORKSPACE_STORE_INSTRUCTIONS,
} from '../lib/memory';

// A memory-store attachment for `sessions.create({ resources })`. Matches the
// SDK's BetaManagedAgentsMemoryStoreResourceParam shape; kept structural so the
// session-create call type-checks it without us importing a deep beta path.
export type MemoryStoreResource = {
  type: 'memory_store';
  memory_store_id: string;
  access: 'read_write' | 'read_only';
  instructions: string;
};

// Attach personal memory read_write. Workspace memory is read_write for
// owners/admins and read_only for members, enforcing access in the provider.
// Omit unprovisioned stores; two stores fit within the per-session cap.
export async function resolveSessionMemoryResources(input: {
  organizationId: string;
  userId: string;
}): Promise<MemoryStoreResource[]> {
  const ws = (
    await db
      .select({ storeId: workspace.workspaceMemoryStoreId })
      .from(workspace)
      .where(eq(workspace.organizationId, input.organizationId))
      .limit(1)
  ).at(0);

  const wm = (
    await db
      .select({ storeId: workspaceMember.userMemoryStoreId })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.userId),
        ),
      )
      .limit(1)
  ).at(0);

  // Org role for the workspace-store access decision. Missing row → null role
  // → read_only (fails closed, same stance as the editor gate).
  const mem = (
    await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
      .limit(1)
  ).at(0);

  const resources: MemoryStoreResource[] = [];
  if (wm?.storeId) {
    resources.push({
      type: 'memory_store',
      memory_store_id: wm.storeId,
      access: 'read_write',
      instructions: USER_STORE_INSTRUCTIONS,
    });
  }
  if (ws?.storeId) {
    resources.push({
      type: 'memory_store',
      memory_store_id: ws.storeId,
      access: mem && roleIsAtLeast(mem.role, 'admin') ? 'read_write' : 'read_only',
      instructions: WORKSPACE_STORE_INSTRUCTIONS,
    });
  }
  await appendFileListings(resources);
  return resources;
}

// A slow store must not delay session create: no retries, a short per-request
// timeout, and a hard cap on how many paths we collect (far more than the
// instructions cap can render anyway).
const LISTING_TIMEOUT_MS = 1500;
const LISTING_MAX_PATHS = 500;

async function appendFileListings(resources: MemoryStoreResource[]): Promise<void> {
  const client = getAnthropicClient();
  if (!client || resources.length === 0) return;
  await Promise.all(
    resources.map(async (resource) => {
      try {
        const paths = await fetchStoreFilePaths(client, resource.memory_store_id);
        resource.instructions = appendMemoryFileListing(resource.instructions, paths);
      } catch (error) {
        // Memory mounts remain usable without a file index; listing failure must not block a task.
        captureException(error, {
          feature: 'memory-attach',
          memoryStoreId: resource.memory_store_id,
        });
      }
    }),
  );
}

async function fetchStoreFilePaths(client: Anthropic, storeId: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const item of client.beta.memoryStores.memories.list(storeId, null, {
    timeout: LISTING_TIMEOUT_MS,
    maxRetries: 0,
  })) {
    if (item.type === 'memory') {
      paths.push(item.path);
      if (paths.length >= LISTING_MAX_PATHS) return paths;
    }
  }
  return paths;
}
