import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { session, sessionToolApproval, toolPermission } from '@/db/schema';
import { listToolkitTools } from '@/lib/composio/toolkit-tools';
import { COMPOSIO_TOOLKIT_ALLOWLIST } from '@/lib/composio/toolkits';
import { composioCapability } from '@/lib/runtime-capabilities';
import { classifyToolAccess } from '../lib/classify';
import {
  combineGateOutcomes,
  decideConnectedAppGate,
  decideOpaqueCall,
  isUnattended,
  readGatedCall,
} from '../lib/resolve';
import type { GateOutcome, ToolPolicy } from '../types';

// The single gate-time choke point: the relay calls this for every
// Anthropic-side ask-gate it sees, live or recovered from history, and acts on
// the outcome. It reads the database per gate, so a policy change applies to
// the very next tool call.

/** Resolve one gate for the session creator, whose credentials execute the call.
 * The session row says whether a person is present and which mode applies. */
export async function resolveToolGate(input: {
  organizationId: string;
  userId: string;
  toolName: string;
  /** The gated call's input, read to find the actions a batch runs. */
  toolInput?: unknown;
  /** OUR session id. */
  sessionId: string;
}): Promise<GateOutcome> {
  const owner = (
    await db
      .select({ kind: session.kind, permissionMode: session.permissionMode })
      .from(session)
      .where(eq(session.id, input.sessionId))
      .limit(1)
  ).at(0);
  // An unknown session leaves the gate for a person.
  if (!owner) return 'gate';

  const call = readGatedCall(input.toolName, input.toolInput, COMPOSIO_TOOLKIT_ALLOWLIST);
  switch (call.kind) {
    case 'opaque':
      return decideOpaqueCall({
        unattended: isUnattended(owner),
        sessionMode: owner.permissionMode,
        creatorHasBlockedAction: await creatorHasBlockedAction(input),
      });
    case 'read_only_meta': {
      const outcome = decideConnectedAppGate({
        policy: null,
        access: 'read',
        sessionMode: owner.permissionMode,
      });
      if (outcome !== 'gate') return outcome;
      const approved = await approvedForSession(input.sessionId, [call.toolName]);
      return approved.has(call.toolName) ? 'allow' : 'gate';
    }
    case 'actions':
      break;
    default: {
      const exhausted: never = call;
      return exhausted;
    }
  }

  const names = call.actions.map((action) => action.toolName);
  const toolkits = [...new Set(call.actions.map((action) => action.toolkit))];
  const [rows, approved, catalogs] = await Promise.all([
    db
      .select({
        toolkit: toolPermission.toolkit,
        toolName: toolPermission.toolName,
        policy: toolPermission.policy,
      })
      .from(toolPermission)
      .where(
        and(
          eq(toolPermission.organizationId, input.organizationId),
          eq(toolPermission.userId, input.userId),
          inArray(toolPermission.toolkit, toolkits),
          inArray(toolPermission.toolName, names),
        ),
      ),
    approvedForSession(input.sessionId, names),
    Promise.all(
      toolkits.map(async (toolkit) => {
        const catalog = await listToolkitTools(toolkit, composioCapability().apiKey);
        return [toolkit, catalog.tools] as const;
      }),
    ).then((entries) => new Map(entries)),
  ]);

  const outcomes = call.actions.map(({ toolkit, toolName }) => {
    const policy: ToolPolicy | null =
      rows.find((row) => row.toolkit === toolkit && row.toolName === toolName)?.policy ?? null;
    const tags = catalogs.get(toolkit)?.find((entry) => entry.slug === toolName)?.tags ?? [];
    const outcome = decideConnectedAppGate({
      policy,
      access: classifyToolAccess(toolName, tags),
      sessionMode: owner.permissionMode,
    });
    // A task approval skips only a prompt. A Block stays a deny.
    return outcome === 'gate' && approved.has(toolName) ? 'allow' : outcome;
  });
  return combineGateOutcomes(outcomes);
}

async function approvedForSession(sessionId: string, names: string[]): Promise<Set<string>> {
  const rows = await db
    .select({ toolName: sessionToolApproval.toolName })
    .from(sessionToolApproval)
    .where(
      and(
        eq(sessionToolApproval.sessionId, sessionId),
        inArray(sessionToolApproval.toolName, names),
      ),
    );
  return new Set(rows.map((row) => row.toolName));
}

// Any Block on an enabled toolkit counts, connected or not: the stricter reading always holds.
async function creatorHasBlockedAction(input: {
  organizationId: string;
  userId: string;
}): Promise<boolean> {
  const row = (
    await db
      .select({ toolName: toolPermission.toolName })
      .from(toolPermission)
      .where(
        and(
          eq(toolPermission.organizationId, input.organizationId),
          eq(toolPermission.userId, input.userId),
          inArray(toolPermission.toolkit, [...COMPOSIO_TOOLKIT_ALLOWLIST]),
          eq(toolPermission.policy, 'block'),
        ),
      )
      .limit(1)
  ).at(0);
  return row !== undefined;
}
