import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { schedulePublishSessionEvent } from '@/features/realtime/server';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import { ToolError } from '@/lib/errors';
import { applyBrowserControlTransition } from './browser-control-transition';
import { readBrowserRecord } from './browser-lifecycle';
import { expireBrowserControl, renewBrowserControl } from './browser-transitions';

export async function sendBrowserControlSignal(
  grant: SessionWriteGrant,
  controlledByUser: boolean,
): Promise<void> {
  const input = {
    sessionRowId: grant.sessionRowId,
    anthropicSessionId: grant.anthropicSessionId,
    organizationId: grant.organizationId,
    controlledByUser,
  };
  await expireBrowserControl(input.sessionRowId);
  const browser = await readBrowserRecord(input.sessionRowId);
  if (browser.status !== 'active' && browser.status !== 'acting' && browser.status !== 'user') {
    throw new ToolError('TOOL_INPUT_INVALID', 'No live browser session is open', {
      sessionRowId: input.sessionRowId,
    });
  }
  const client = requireAnthropicClient();
  const changed = await applyBrowserControlTransition(browser.status === 'user', input, client);
  if (!changed) return;
  // The whisper is a user.message: it starts a turn upstream, but a viewer
  // whose stream settled on the previous idle would never see it (or the
  // agent's reply) until a reload. The status event published by a creator's
  // message makes an open chat view re-attach its stream.
  schedulePublishSessionEvent(
    { type: 'session_status', sessionId: input.sessionRowId, status: 'running' },
    {
      organizationId: input.organizationId,
      session: { visibility: grant.visibility, createdByUserId: grant.createdByUserId },
    },
  );
}

export async function renewBrowserControlLease(grant: SessionWriteGrant): Promise<void> {
  const { sessionRowId } = grant;
  if (!(await renewBrowserControl(sessionRowId)))
    throw new ToolError('CONFLICT', 'Browser control lease is no longer held', { sessionRowId });
}
