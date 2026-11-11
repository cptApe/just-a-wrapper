'use server';

import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { toolPermission } from '@/db/schema';
import { isCustomToolName, isToolAvailable } from '@/features/tool-catalog/declarations';
import { type Caller, resolveCaller } from '@/lib/caller';
import { COMPOSIO_TOOLKIT_ALLOWLIST } from '@/lib/composio/toolkits';
import { AppError } from '@/lib/errors';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import { BUILTIN_TOOLKIT, customToolDefaultPolicy, isConfigurableCustomTool } from '../constants';
import { toolkitFromToolName } from '../lib/resolve';
import {
  parseStoredToolSettings,
  QUALITY_CONFIGURABLE_TOOLS,
  ToolSettingsSchema,
} from '../lib/tool-settings';
import type { ToolkitPermissions, ToolPermissionChange, ToolPolicy } from '../types';
import { writeMemberToolPermissionChanges, writeToolSettings } from './tool-policy-transitions';

// Server actions backing the permission UIs (the #app/<id> overlay's Manage
// permissions section and the Built-in tab): read one toolkit's exact per-tool
// rows and atomically save groups of row changes. All scoped to the signed-in
// caller's own member identity. The `builtin` toolkit rides the same table.

const Toolkit = z.enum([...COMPOSIO_TOOLKIT_ALLOWLIST, BUILTIN_TOOLKIT]);
// Upstream tool names are Composio action slugs (GMAIL_SEND_EMAIL) or custom
// tool names (save_skill). `assertGateReads` checks each against its toolkit.
const ToolName = z.string().min(1).max(200);
const Policy = z.enum(['allow', 'ask', 'block']);
const Target = z.object({ kind: z.literal('tool'), toolName: ToolName });

const BatchInput = z.object({
  toolkit: Toolkit,
  changes: z.array(z.object({ target: Target, policy: Policy.nullable() })).min(1),
});
// Settings only exist for the quality-configurable built-in tools, which
// are all `safe`. Restricting the write here keeps `setToolSettings` from ever
// materializing a policy row for some OTHER tool, where the risk-default insert
// policy would not match that tool's true no-row gate outcome.
const SetSettingsInput = z
  .object({
    toolkit: Toolkit,
    toolName: ToolName,
    settings: ToolSettingsSchema,
  })
  .refine(
    (input) => input.toolkit === BUILTIN_TOOLKIT && QUALITY_CONFIGURABLE_TOOLS.has(input.toolName),
    'settings are only configurable for built-in generation tools',
  );

/** Refuse a row the gate would never read: a built-in that is not configurable
 * here, or an action name outside the toolkit it is saved under. */
function assertGateReads(toolkit: string, toolName: string): void {
  const read =
    toolkit === BUILTIN_TOOLKIT
      ? isToolAvailable(toolName, capabilities) && isConfigurableCustomTool(toolName)
      : toolkitFromToolName(toolName, COMPOSIO_TOOLKIT_ALLOWLIST) === toolkit;
  if (!read) {
    throw new AppError('TOOL_NOT_FOUND', 'Tool is not enabled on this deployment', {
      toolkit,
      toolName,
    });
  }
}

/** One toolkit's persisted policy rows for the signed-in member. */
export async function getToolkitPermissions(toolkit: string): Promise<ToolkitPermissions> {
  return withRequestContext(
    { route: 'permissions/tool-policies/get', feature: 'permissions' },
    async () => {
      try {
        return await loadToolkitPermissions(toolkit);
      } catch (error) {
        // Next reports the thrown action error through onRequestError with its cause.
        throw new AppError(
          'UNEXPECTED',
          'Could not load permission settings',
          { toolkit },
          { cause: error },
        );
      }
    },
  );
}

async function loadToolkitPermissions(toolkit: string): Promise<ToolkitPermissions> {
  const slug = Toolkit.parse(toolkit);
  const caller = await resolveCaller(await headers());
  return readToolkitPermissions(slug, caller, db);
}

async function readToolkitPermissions(
  slug: string,
  caller: Pick<Caller, 'organizationId' | 'userId'>,
  reader: Pick<typeof db, 'select'>,
): Promise<ToolkitPermissions> {
  const rows = await reader
    .select({
      toolName: toolPermission.toolName,
      policy: toolPermission.policy,
      settings: toolPermission.settings,
    })
    .from(toolPermission)
    .where(
      and(
        eq(toolPermission.organizationId, caller.organizationId),
        eq(toolPermission.userId, caller.userId),
        eq(toolPermission.toolkit, slug),
      ),
    );

  const tools: Record<string, ToolPolicy> = {};
  const settings: ToolkitPermissions['settings'] = {};
  for (const row of rows) {
    tools[row.toolName] = row.policy;
    if (row.settings !== null) {
      const parsed = parseStoredToolSettings(row.settings);
      if (parsed.defaultQuality !== undefined) settings[row.toolName] = parsed;
    }
  }
  return { tools, settings };
}

/**
 * Upsert one tool's non-policy settings: the default generation quality.
 * Settings live on the SAME row as the tool's policy, so a row with no policy yet
 * is materialized with the tool's risk default. The input is restricted to the
 * quality-configurable built-in tools (all `safe`), whose risk default is
 * `allow` — behavior-identical to having no row at all for a safe built-in, so
 * configuring a quality never tightens or loosens the gate. An existing row keeps
 * its policy and only its settings change.
 */
export async function setToolSettings(input: {
  toolkit: string;
  toolName: string;
  settings: { defaultQuality?: 'low' | 'mid' | 'high' };
}): Promise<void> {
  return withRequestContext(
    { route: 'permissions/tool-policies/set-settings', feature: 'permissions' },
    async () => {
      const parsed = SetSettingsInput.parse(input);
      const caller = await resolveCaller(await headers());
      // Guaranteed a safe built-in tool by SetSettingsInput's refine, so this is
      // always `allow` — the neutral no-row equivalent for a safe built-in.
      const insertPolicy: ToolPolicy = isCustomToolName(parsed.toolName)
        ? customToolDefaultPolicy()
        : 'allow';
      await writeToolSettings({
        organizationId: caller.organizationId,
        userId: caller.userId,
        toolkit: parsed.toolkit,
        toolName: parsed.toolName,
        policy: insertPolicy,
        settings: parsed.settings,
      });
    },
  );
}

/** Validate the whole edit before writing; return the rows read inside its transaction. */
export async function setToolPermissions(input: {
  toolkit: string;
  changes: ReadonlyArray<ToolPermissionChange>;
}): Promise<ToolkitPermissions> {
  return withRequestContext(
    { route: 'permissions/tool-policies/set-batch', feature: 'permissions' },
    async () => {
      try {
        const parsed = BatchInput.parse(input);
        for (const { target } of parsed.changes) assertGateReads(parsed.toolkit, target.toolName);
        const caller = await resolveCaller(await headers());
        return await db.transaction(async (tx) => {
          await writeMemberToolPermissionChanges(
            {
              organizationId: caller.organizationId,
              userId: caller.userId,
              toolkit: parsed.toolkit,
              changes: parsed.changes.map(({ target, policy }) => ({
                toolName: target.toolName,
                policy,
              })),
            },
            tx,
          );
          return readToolkitPermissions(parsed.toolkit, caller, tx);
        });
      } catch (error) {
        throw new AppError(
          'UNEXPECTED',
          'Could not save permission settings',
          {},
          { cause: error },
        );
      }
    },
  );
}
