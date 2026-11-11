import 'server-only';
import { schedulePublishSessionEvent } from '@/features/realtime/server';
import { scheduleSessionTitleGeneration } from './generate-session-title';
import type { DispatchPendingToolCalls } from './reconcile-stale-sessions';
import { startChatSession } from './start-chat-session';

// Opens a chat for a person who is present to act on a refusal; startChatSession runs the spend gate.
export async function createInteractiveChat(input: {
  workspaceId: string;
  organizationId: string;
  userId: string;
  message: string;
  tier: 'fast' | 'default' | 'pro';
  deferMessage: boolean;
  dispatchPendingToolCalls: DispatchPendingToolCalls;
}): Promise<{ sessionId: string }> {
  const { workspaceId, organizationId, userId, message, tier, deferMessage } = input;
  // The client navigates with the local session uuid; background upstream
  // operations use anthropicSessionId.
  const { sessionId, anthropicSessionId } = await startChatSession({
    kind: 'chat',
    // Interactive tools auto-approve unless a per-tool Ask/Block policy overrides them.
    permissionMode: 'auto',
    message,
    tier,
    deferInitialMessage: deferMessage,
    workspaceId,
    createdByUserId: userId,
    organizationId,
    dispatchPendingToolCalls: input.dispatchPendingToolCalls,
  });

  // New chats are private, so publish only to the creator's member channel.
  // Notification failure must not fail creation.
  schedulePublishSessionEvent(
    { type: 'session_status', sessionId, status: deferMessage ? 'idle' : 'running' },
    { organizationId, session: { visibility: 'private', createdByUserId: userId } },
  );

  // Deferred sessions are named from their first send so the title model sees attachments.
  // Background title failure leaves the stored neutral title.
  if (!deferMessage)
    scheduleSessionTitleGeneration({
      anthropicSessionId,
      workspaceId,
      organizationId,
      message,
      userId,
    });

  return { sessionId };
}
