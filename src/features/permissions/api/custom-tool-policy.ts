import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { toolPermission, workspace } from '@/db/schema';
import { BUILTIN_TOOLKIT } from '../constants';
import { parseStoredToolSettings, type ToolSettings } from '../lib/tool-settings';
import type { ToolPolicy } from '../types';

// Custom-tool choices use exact per-tool rows under the builtin sentinel.
// No stored choice means the dispatcher applies the risk/session default.
// Parse policy at the read boundary because database typing alone cannot validate it.
const PolicySchema: z.ZodType<ToolPolicy> = z.enum(['allow', 'ask', 'block']);

/** The user's explicit policy for one custom tool, or null when unset. */
export async function resolveCustomToolPolicy(input: {
  organizationId: string;
  userId: string;
  toolName: string;
}): Promise<ToolPolicy | null> {
  const row = (
    await db
      .select({ policy: toolPermission.policy })
      .from(toolPermission)
      .where(
        and(
          eq(toolPermission.organizationId, input.organizationId),
          eq(toolPermission.userId, input.userId),
          eq(toolPermission.toolkit, BUILTIN_TOOLKIT),
          eq(toolPermission.toolName, input.toolName),
        ),
      )
      .limit(1)
  ).at(0);
  return row ? PolicySchema.parse(row.policy) : null;
}

/**
 * The non-policy settings a user has stored for one built-in tool — the
 * default generation quality. A tool handler has the caller's `workspaceId` and
 * `userId` in its context but not the `organizationId` the permission rows are
 * keyed by, so this joins `tool_permission` to `workspace` on the org in one
 * round-trip. Returns `{}` when the row is missing or the stored blob is
 * malformed (read-boundary parse degrades to no default, never throws).
 */
export async function resolveToolSettings(input: {
  workspaceId: string;
  userId: string;
  toolName: string;
}): Promise<ToolSettings> {
  const row = (
    await db
      .select({ settings: toolPermission.settings })
      .from(toolPermission)
      .innerJoin(workspace, eq(workspace.organizationId, toolPermission.organizationId))
      .where(
        and(
          eq(workspace.id, input.workspaceId),
          eq(toolPermission.userId, input.userId),
          eq(toolPermission.toolkit, BUILTIN_TOOLKIT),
          eq(toolPermission.toolName, input.toolName),
        ),
      )
      .limit(1)
  ).at(0);
  return row?.settings ? parseStoredToolSettings(row.settings) : {};
}
