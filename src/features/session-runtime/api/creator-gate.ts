import 'server-only';
import { resolveToolGate } from '@/features/permissions/api/gate-policy';
import type { GateOutcome, PermissionMode } from '@/features/permissions/types';
import { sessionActorRefusal } from '@/features/sessions/api/assert-session-actor';
import { shipLog } from '@/lib/logger';

type GateSession = {
  organizationId: string;
  sessionRowId: string;
  createdByUserId: string;
  permissionMode: PermissionMode;
};

// Automatic gate answers act as the creator, whoever's relay or recovery sweep sees the gate.
// A creator who left the workspace, or lost admin on a read-write-memory task, answers nothing:
// the gate stays open, and confirmToolUses refuses a manual answer on the same rule.
export function creatorGateResolver(
  session: GateSession,
): (toolName: string, toolInput: unknown) => Promise<GateOutcome> {
  return async (toolName, toolInput) => {
    const refusal = await sessionActorRefusal(session.sessionRowId, session.createdByUserId);
    if (refusal) {
      shipLog({
        level: 'warn',
        msg: 'sessions.gate_actor_refused',
        feature: 'sessions',
        op: 'resolve-gate',
        session_id: session.sessionRowId,
        tool_name: toolName,
        reason: refusal.message,
      });
      return 'gate';
    }
    return resolveToolGate({
      organizationId: session.organizationId,
      userId: session.createdByUserId,
      sessionId: session.sessionRowId,
      toolName,
      toolInput,
    });
  };
}
