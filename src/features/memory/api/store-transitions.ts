import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceMember } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { createMemoryStore } from './memory-store-client';

type StoreTarget =
  | { kind: 'workspace'; id: string }
  | { kind: 'member'; organizationId: string; userId: string };

// A member store belongs to one membership; a rejoin starts a new one.
type StoreOwner =
  | { kind: 'workspace'; id: string; storeId: string | null }
  | {
      kind: 'member';
      organizationId: string;
      userId: string;
      membershipId: string;
      storeId: string | null;
    };

export async function provisionStore(
  client: Anthropic,
  target: StoreTarget,
  params: { name: string; description: string; metadata: Record<string, string> },
): Promise<void> {
  const owner = await readOwner(target);
  if (!owner)
    throw new AppError('CONFLICT', 'Memory store owner disappeared during provisioning', target);
  if (owner.storeId) return;
  // composioUserId is minted per membership, so a rejoin never adopts a store
  // that the earlier membership's pending cleanup is about to delete.
  const key = owner.kind === 'workspace' ? `workspace:${owner.id}` : `member:${owner.membershipId}`;
  const candidates: string[] = [];
  for await (const remote of client.beta.memoryStores.list()) {
    if (remote.metadata?.provision_key === key) candidates.push(remote.id);
  }
  let candidate = candidates.at(0);
  if (!candidate) {
    candidate = await createMemoryStore(client, {
      ...params,
      metadata: { ...params.metadata, provision_key: key },
    });
    candidates.push(candidate);
  }
  const moved = await linkStore(owner, candidate);
  const linked = await readOwner(target);
  if (!linked?.storeId)
    throw new AppError('CONFLICT', 'Memory store owner disappeared during provisioning', {
      key,
      moved,
    });
  // The CAS winner is authoritative. Tagged losers remain discoverable if cleanup fails.
  for (const id of candidates) {
    if (id === linked.storeId) continue;
    try {
      await client.beta.memoryStores.delete(id);
    } catch (cause) {
      if (cause instanceof APIError && cause.status === 404) continue;
      // Cleanup must not undo successful provisioning; tagged losers remain identifiable.
      captureException(
        new AppError(
          'EXTERNAL_API_FAILED',
          'Failed to delete unused memory store',
          { storeId: id, key },
          { cause },
        ),
      );
    }
  }
}

async function readOwner(target: StoreTarget): Promise<StoreOwner | undefined> {
  if (target.kind === 'workspace') {
    const row = (
      await db
        .select({ storeId: workspace.workspaceMemoryStoreId })
        .from(workspace)
        .where(eq(workspace.id, target.id))
    ).at(0);
    return row && { ...target, storeId: row.storeId };
  }
  const row = (
    await db
      .select({
        storeId: workspaceMember.userMemoryStoreId,
        membershipId: workspaceMember.composioUserId,
      })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, target.organizationId),
          eq(workspaceMember.userId, target.userId),
        ),
      )
  ).at(0);
  return row && { ...target, ...row };
}

async function linkStore(owner: StoreOwner, candidate: string): Promise<boolean> {
  if (owner.kind === 'workspace') {
    const changed = await db
      .update(workspace)
      .set({ workspaceMemoryStoreId: candidate, updatedAt: new Date() })
      .where(and(eq(workspace.id, owner.id), isNull(workspace.workspaceMemoryStoreId)))
      .returning({ id: workspace.id });
    return changed.length > 0;
  }
  // The membership guard keeps a run started for a removed membership out of a rejoin.
  const changed = await db
    .update(workspaceMember)
    .set({ userMemoryStoreId: candidate })
    .where(
      and(
        eq(workspaceMember.organizationId, owner.organizationId),
        eq(workspaceMember.userId, owner.userId),
        eq(workspaceMember.composioUserId, owner.membershipId),
        isNull(workspaceMember.userMemoryStoreId),
      ),
    )
    .returning({ id: workspaceMember.userId });
  return changed.length > 0;
}
