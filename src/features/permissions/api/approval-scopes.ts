import 'server-only';
import { db } from '@/db';
import { sessionToolApproval } from '@/db/schema';
import { COMPOSIO_TOOLKIT_ALLOWLIST } from '@/lib/composio/toolkits';
import { AppError } from '@/lib/errors';
import { readGatedCall, taskApprovalNames } from '../lib/resolve';
import { upsertMemberToolPermissions } from './tool-policy-transitions';

/** Remember an approval for the rest of one task, under exact action names only.
 * Idempotent by the table PK. */
export async function rememberToolApprovalForSession(input: {
  sessionId: string;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  const names = taskApprovalNames(
    readGatedCall(input.toolName, input.toolInput, COMPOSIO_TOOLKIT_ALLOWLIST),
  );
  if (names.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'This call cannot be remembered for the task', {
      toolName: input.toolName,
    });
  }
  await db
    .insert(sessionToolApproval)
    .values(names.map((toolName) => ({ sessionId: input.sessionId, toolName })))
    .onConflictDoNothing();
}

/** Persist the exact per-tool Allow choice used by the Tools page. */
export async function allowToolGloballyForMember(input: {
  organizationId: string;
  userId: string;
  toolName: string;
  toolInput: unknown;
}): Promise<void> {
  const call = readGatedCall(input.toolName, input.toolInput, COMPOSIO_TOOLKIT_ALLOWLIST);
  if (call.kind !== 'actions') {
    throw new AppError('VALIDATION_FAILED', 'This tool has no global permission setting', {
      toolName: input.toolName,
    });
  }

  await upsertMemberToolPermissions({
    organizationId: input.organizationId,
    userId: input.userId,
    policy: 'allow',
    tools: call.actions,
  });
}
