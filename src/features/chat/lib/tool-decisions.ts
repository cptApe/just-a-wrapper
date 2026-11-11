// Pure tool-decision state: which calls wait on the user, how each one is answered,
// and what a single tool line may show. The hook in hooks/use-tool-decisions owns the I/O.

import { approvalScopesFor, readGatedCall } from '@/features/permissions/lib/resolve';
import { COMPOSIO_TOOLKIT_ALLOWLIST } from '@/lib/composio/toolkits';
import type { ChatState, ToolChatItem } from './chat-state';
import { selectPendingGates, toolsStopped } from './chat-turns';
import type { ToolRequests } from './tool-request-machine';

/** A remembered approval: for the rest of this task, or as the owner's Tools page setting. */
export type RememberScope = 'session' | 'always';

/** One answer from an approval card. */
export type GateAnswer = 'once' | RememberScope | 'deny';

/** Built-in gates are relayed from the provider; custom gates come from our dispatcher. */
type GateSource = 'builtin' | 'custom';

export type PendingDecision = {
  source: GateSource;
  /** A decision for this call is in flight. */
  busy: boolean;
  /** The one remembered approval the card may offer, or null when none can work. */
  remember: RememberScope | null;
  /** The helper thread that owns a built-in gate raised inside a sub-agent. */
  threadId?: string;
};

/** What one tool line shows for its decision. */
export type ToolGate =
  | { kind: 'none' }
  | {
      kind: 'pending';
      busy: boolean;
      remember: RememberScope | null;
      resolve: (answer: GateAnswer) => void;
    }
  /** Waiting on a decision this viewer cannot make (a teammate on a shared task). */
  | { kind: 'readonly' };

export type ToolDecisions = {
  pending: ReadonlyMap<string, PendingDecision>;
  /** The viewer may answer approvals (the task owner). */
  canDecide: boolean;
  resolve: (toolUseId: string, answer: GateAnswer) => void;
};

export const NO_TOOL_DECISIONS: ToolDecisions = {
  pending: new Map(),
  canDecide: false,
  resolve: () => {},
};

/**
 * The remembered approval a built-in gate can offer. It follows the server's own
 * contract (`approvalScopesFor`): "Always" only for a call the Tools page can store,
 * and only for the owner; otherwise "for this task" when the task can remember it.
 */
export function rememberScopeFor(
  item: Pick<ToolChatItem, 'name' | 'input'>,
  canSetGlobalPermission: boolean,
): RememberScope | null {
  const scopes = approvalScopesFor(
    readGatedCall(item.name, item.input, COMPOSIO_TOOLKIT_ALLOWLIST),
  );
  if (scopes.always && canSetGlobalPermission) return 'always';
  return scopes.task ? 'session' : null;
}

/** Every call waiting on a decision, from both sources, keyed by tool use id. */
export function selectPendingDecisions(input: {
  state: Pick<ChatState, 'items' | 'status'>;
  /** Custom calls the server holds for confirmation. */
  customPendingIds: readonly string[];
  requests: ToolRequests;
  canSetGlobalPermission: boolean;
}): ReadonlyMap<string, PendingDecision> {
  const { state, customPendingIds, requests, canSetGlobalPermission } = input;
  const pending = new Map<string, PendingDecision>();
  if (toolsStopped(state)) return pending;
  const busy = (id: string) => requests.get(id)?.kind === 'confirming';
  for (const gate of selectPendingGates(state))
    pending.set(gate.id, {
      source: 'builtin',
      busy: busy(gate.id),
      remember: rememberScopeFor(gate, canSetGlobalPermission),
      ...(gate.threadId ? { threadId: gate.threadId } : {}),
    });
  for (const id of customPendingIds)
    if (requests.get(id)?.kind !== 'posted')
      pending.set(id, { source: 'custom', busy: busy(id), remember: null });
  return pending;
}

/** True when both maps hold the same calls in the same decision state. */
export function samePendingDecisions(
  a: ReadonlyMap<string, PendingDecision>,
  b: ReadonlyMap<string, PendingDecision>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, left] of a) {
    const right = b.get(id);
    if (
      !right ||
      left.source !== right.source ||
      left.busy !== right.busy ||
      left.remember !== right.remember ||
      left.threadId !== right.threadId
    )
      return false;
  }
  return true;
}

/** The decision state of one tool line. */
export function toolGateOf(decisions: ToolDecisions, toolUseId: string): ToolGate {
  const pending = decisions.pending.get(toolUseId);
  if (!pending) return { kind: 'none' };
  if (!decisions.canDecide) return { kind: 'readonly' };
  return {
    kind: 'pending',
    busy: pending.busy,
    remember: pending.remember,
    resolve: (answer) => decisions.resolve(toolUseId, answer),
  };
}
