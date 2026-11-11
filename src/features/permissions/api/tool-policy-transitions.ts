import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { toolPermission } from '@/db/schema';
import { defaultPolicyForToolAccess, type ToolAccess } from '../lib/classify';
import type { ToolSettings } from '../lib/tool-settings';
import type { ToolPolicy } from '../types';

type MemberToolPermissionWrite = {
  organizationId: string;
  userId: string;
  policy: ToolPolicy;
  tools: ReadonlyArray<{ toolkit: string; toolName: string }>;
};

// The one persistence path for exact per-member tool policies. The Tools page
// batch action and the inline gate's "Always" choice both delegate here, so
// their conflict behavior and timestamps cannot drift.
export async function upsertMemberToolPermissions(
  input: MemberToolPermissionWrite,
  writer: Pick<typeof db, 'insert'> = db,
): Promise<void> {
  if (input.tools.length === 0) return;
  await writer
    .insert(toolPermission)
    .values(
      input.tools.map((tool) => ({
        organizationId: input.organizationId,
        userId: input.userId,
        toolkit: tool.toolkit,
        toolName: tool.toolName,
        policy: input.policy,
        policySource: 'member' as const,
      })),
    )
    .onConflictDoUpdate({
      target: [
        toolPermission.organizationId,
        toolPermission.userId,
        toolPermission.toolkit,
        toolPermission.toolName,
      ],
      set: { policy: input.policy, policySource: 'member', updatedAt: sql`now()` },
    });
}

/**
 * Materialize the product defaults for a newly connected app without
 * overwriting choices the member has already made.
 */
export async function insertDefaultMemberToolPermissions(input: {
  organizationId: string;
  userId: string;
  tools: ReadonlyArray<{ toolkit: string; toolName: string; access: ToolAccess }>;
}): Promise<void> {
  if (input.tools.length === 0) return;
  await db
    .insert(toolPermission)
    .values(
      input.tools.map((tool) => ({
        organizationId: input.organizationId,
        userId: input.userId,
        toolkit: tool.toolkit,
        toolName: tool.toolName,
        policy: defaultPolicyForToolAccess(tool.access),
        policySource: 'default' as const,
      })),
    )
    .onConflictDoNothing();
}

/** Mixed policy updates and clears share the caller's transaction. */
export async function writeMemberToolPermissionChanges(
  input: {
    organizationId: string;
    userId: string;
    toolkit: string;
    changes: ReadonlyArray<{ toolName: string; policy: ToolPolicy | null }>;
  },
  writer: Pick<typeof db, 'insert' | 'delete'>,
): Promise<void> {
  // Last occurrence wins, including a clear after an update to the same target.
  const changes = new Map(input.changes.map((change) => [change.toolName, change.policy]));
  const removed = [...changes].filter(([, policy]) => policy === null).map(([name]) => name);
  if (removed.length > 0) {
    await writer
      .delete(toolPermission)
      .where(
        and(
          eq(toolPermission.organizationId, input.organizationId),
          eq(toolPermission.userId, input.userId),
          eq(toolPermission.toolkit, input.toolkit),
          inArray(toolPermission.toolName, removed),
        ),
      );
  }
  for (const policy of ['allow', 'ask', 'block'] as const) {
    await upsertMemberToolPermissions(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        policy,
        tools: [...changes]
          .filter(([, value]) => value === policy)
          .map(([toolName]) => ({ toolkit: input.toolkit, toolName })),
      },
      writer,
    );
  }
}

export async function writeToolSettings(input: {
  organizationId: string;
  userId: string;
  toolkit: string;
  toolName: string;
  policy: ToolPolicy;
  settings: ToolSettings;
}): Promise<void> {
  await db
    .insert(toolPermission)
    .values({ ...input, policySource: 'default' })
    .onConflictDoUpdate({
      target: [
        toolPermission.organizationId,
        toolPermission.userId,
        toolPermission.toolkit,
        toolPermission.toolName,
      ],
      set: { settings: input.settings },
    });
}
