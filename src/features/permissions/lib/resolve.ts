// Pure gate decisions. No value imports and no side effects, so Node's
// type-stripping test runner loads it directly (tests/permissions/gate.test.mjs).

import type { GateOutcome, PermissionMode, ToolPolicy } from '../types';
import type { ToolAccess } from './classify';

/** The Tool Router batch executor: its input names the actions it runs. */
export const TOOL_ROUTER_EXECUTOR = 'COMPOSIO_MULTI_EXECUTE_TOOL';

/**
 * Tool Router meta-tools that cannot run a toolkit action: they search the
 * catalog, read schemas or report connection state. Every other meta-tool
 * (the remote workbench and bash sandbox, and any meta-tool Composio adds
 * later) is treated as able to run any action.
 */
const READ_ONLY_META_TOOLS: ReadonlySet<string> = new Set([
  'COMPOSIO_SEARCH_TOOLS',
  'COMPOSIO_GET_TOOL_SCHEMAS',
  'COMPOSIO_MANAGE_CONNECTIONS',
]);

/**
 * Pull the action slugs out of an executor call for display. Lenient: entries
 * it cannot read are skipped. The gate uses `readGatedCall`, which is strict.
 */
export function extractEmbeddedToolSlugs(toolName: string, input: unknown): string[] {
  if (toolName !== TOOL_ROUTER_EXECUTOR) return [];
  if (typeof input !== 'object' || input === null || !('tools' in input)) return [];
  const tools = input.tools;
  if (!Array.isArray(tools)) return [];
  const slugs: string[] = [];
  for (const entry of tools) {
    if (typeof entry !== 'object' || entry === null || !('tool_slug' in entry)) continue;
    const slug: unknown = entry.tool_slug;
    if (typeof slug === 'string' && slug.length > 0) slugs.push(slug);
  }
  return slugs;
}

/**
 * Map an upstream tool name to its toolkit slug. Composio action slugs are the
 * uppercased toolkit slug plus an underscore (GMAIL_SEND_EMAIL → gmail), so the
 * longest matching prefix wins (a `google` toolkit can never shadow
 * `googlecalendar`). Meta-tools and unknown names return null.
 */
export function toolkitFromToolName(toolName: string, toolkits: readonly string[]): string | null {
  const upper = toolName.toUpperCase();
  let match: string | null = null;
  for (const slug of toolkits) {
    if (!upper.startsWith(`${slug.toUpperCase()}_`)) continue;
    if (match === null || slug.length > match.length) match = slug;
  }
  return match;
}

/** What the gate can read from one connected-app tool call. */
export type GatedCall =
  /** Every action the call runs, exactly. */
  | { kind: 'actions'; actions: ReadonlyArray<{ toolkit: string; toolName: string }> }
  /** A meta-tool that cannot run an action. */
  | { kind: 'read_only_meta'; toolName: string }
  /** The gate cannot tell which actions this call runs. */
  | { kind: 'opaque' };

/**
 * Read a gated call. Fails closed: an executor input with any entry the parser
 * does not recognise, an action outside the enabled toolkits, and every
 * meta-tool not on `READ_ONLY_META_TOOLS` are opaque.
 */
export function readGatedCall(
  toolName: string,
  input: unknown,
  toolkits: readonly string[],
): GatedCall {
  if (READ_ONLY_META_TOOLS.has(toolName)) return { kind: 'read_only_meta', toolName };
  const names = toolName === TOOL_ROUTER_EXECUTOR ? executorSlugs(input) : [toolName];
  if (names === null || names.length === 0) return { kind: 'opaque' };
  const actions: { toolkit: string; toolName: string }[] = [];
  for (const name of new Set(names)) {
    const toolkit = toolkitFromToolName(name, toolkits);
    if (toolkit === null) return { kind: 'opaque' };
    actions.push({ toolkit, toolName: name });
  }
  return { kind: 'actions', actions };
}

// Null when any part of the executor input is not the documented shape.
function executorSlugs(input: unknown): string[] | null {
  if (typeof input !== 'object' || input === null || !('tools' in input)) return null;
  const tools = input.tools;
  if (!Array.isArray(tools)) return null;
  const slugs: string[] = [];
  for (const entry of tools) {
    if (typeof entry !== 'object' || entry === null || !('tool_slug' in entry)) return null;
    const slug: unknown = entry.tool_slug;
    if (typeof slug !== 'string' || slug.length === 0) return null;
    slugs.push(slug);
  }
  return slugs;
}

/**
 * The approval scopes a person may remember for a call. A task approval is
 * stored under each exact action name, so an opaque call has none: storing a
 * meta-tool's own name would approve every action it could run later. "Always"
 * writes a Tools page row, which exists only for real actions.
 */
export function approvalScopesFor(call: GatedCall): { task: boolean; always: boolean } {
  switch (call.kind) {
    case 'actions':
      return { task: true, always: true };
    case 'read_only_meta':
      return { task: true, always: false };
    case 'opaque':
      return { task: false, always: false };
    default: {
      const exhausted: never = call;
      return exhausted;
    }
  }
}

/** The tool names a task approval is stored under, or [] when it cannot be remembered. */
export function taskApprovalNames(call: GatedCall): string[] {
  switch (call.kind) {
    case 'actions':
      return call.actions.map((action) => action.toolName);
    case 'read_only_meta':
      return [call.toolName];
    case 'opaque':
      return [];
    default: {
      const exhausted: never = call;
      return exhausted;
    }
  }
}

/** True for a session no person watches: a task run that skips confirmations. */
export function isUnattended(session: {
  kind: 'chat' | 'task_run';
  permissionMode: PermissionMode;
}) {
  return session.kind === 'task_run' && session.permissionMode === 'auto';
}

/**
 * Decide one connected-app action the gate can read. Block, Allow and Ask
 * always win. With no row, writes ask and reads follow the session mode.
 */
export function decideConnectedAppGate(input: {
  policy: ToolPolicy | null;
  access: ToolAccess;
  sessionMode: PermissionMode;
}): GateOutcome {
  switch (input.policy) {
    case 'block':
      return 'deny';
    case 'allow':
      return 'allow';
    case 'ask':
      return 'gate';
    case null:
      if (input.access === 'write') return 'gate';
      return input.sessionMode === 'auto' ? 'allow' : 'gate';
    default: {
      const exhausted: never = input.policy;
      return exhausted;
    }
  }
}

/**
 * The block rule for calls the gate cannot read: while the creator has Block
 * on any connected-app action the gate cannot prove the call avoids it, so an
 * unattended run refuses it and a session with a person present asks. With no
 * Block it follows the session mode, as every other unknown does.
 */
export function decideOpaqueCall(input: {
  unattended: boolean;
  sessionMode: PermissionMode;
  creatorHasBlockedAction: boolean;
}): GateOutcome {
  if (input.creatorHasBlockedAction) return input.unattended ? 'refuse' : 'gate';
  if (input.unattended) return 'allow';
  return input.sessionMode === 'auto' ? 'allow' : 'gate';
}

/** One blocked action denies the whole batch, else any gate gates it. */
export function combineGateOutcomes(outcomes: readonly GateOutcome[]): GateOutcome {
  if (outcomes.includes('deny')) return 'deny';
  if (outcomes.includes('refuse')) return 'refuse';
  if (outcomes.includes('gate')) return 'gate';
  return 'allow';
}

const BLOCKED_ACTION_MESSAGE =
  "The user's permission settings block this action for this integration. " +
  'Do not retry it; if the action is needed, ask the user to change its ' +
  'permission on the Plugins page.';

const UNREADABLE_UNATTENDED_MESSAGE =
  'This task runs without a person present, and the user has blocked some app actions. ' +
  'This tool cannot prove which actions it runs, so it was refused. ' +
  `Call each app action directly or through ${TOOL_ROUTER_EXECUTOR} with explicit tool_slug entries instead.`;

/** The answer the relay posts for a decided gate, with the reason the agent reads. */
export function gateConfirmation(outcome: Exclude<GateOutcome, 'gate'>): {
  result: 'allow' | 'deny';
  denyMessage?: string;
} {
  switch (outcome) {
    case 'allow':
      return { result: 'allow' };
    case 'deny':
      return { result: 'deny', denyMessage: BLOCKED_ACTION_MESSAGE };
    case 'refuse':
      return { result: 'deny', denyMessage: UNREADABLE_UNATTENDED_MESSAGE };
    default: {
      const exhausted: never = outcome;
      return exhausted;
    }
  }
}

/** What the dispatcher does with a built-in (custom) tool call. */
export type BuiltinToolGate = 'run' | 'park' | 'block';

/**
 * The one decider for built-in tools, used by the dispatcher and the Tools
 * page. Block refuses and Ask parks. An `alwaysAsk` tool parks under Allow
 * and with no row. Otherwise Allow and no row run.
 */
export function decideBuiltinToolGate(input: {
  policy: ToolPolicy | null;
  alwaysAsk: boolean;
}): BuiltinToolGate {
  switch (input.policy) {
    case 'block':
      return 'block';
    case 'ask':
      return 'park';
    case 'allow':
    case null:
      return input.alwaysAsk ? 'park' : 'run';
    default: {
      const exhausted: never = input.policy;
      return exhausted;
    }
  }
}
