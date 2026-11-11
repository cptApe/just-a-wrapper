import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { getAnthropicClient } from '@/features/agents';
import { ToolError } from '@/lib/errors';
import { readBrowserRecord } from './browser-lifecycle';
import { moveBrowser } from './browser-transitions';

const BROWSER_CONTROL_USER_TEXT = '[The user took control of the browser]';

const BROWSER_CONTROL_AGENT_TEXT = '[The user handed the browser back to the agent]';

export type BrowserControlInput = {
  sessionRowId: string;
  anthropicSessionId: string;
  organizationId: string;
  controlledByUser: boolean;
};
export async function readControlled(input: BrowserControlInput) {
  const row = await readBrowserRecord(input.sessionRowId);
  if (row.status !== 'active' && row.status !== 'acting' && row.status !== 'user')
    throw new ToolError('TOOL_INPUT_INVALID', 'No live browser session is open', {
      sessionRowId: input.sessionRowId,
    });
  return row.status === 'user';
}
export async function setControlled(
  input: BrowserControlInput,
  { controlled, expectedCurrent }: { controlled: boolean; expectedCurrent: boolean },
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.sessionRowId}, 0))`);
    const row = await readBrowserRecord(input.sessionRowId, tx);
    if (row.status !== 'active' && row.status !== 'acting' && row.status !== 'user') return false;
    if ((row.status === 'user') !== expectedCurrent) return false;
    return moveBrowser(
      {
        sessionRowId: input.sessionRowId,
        browserId: row.id,
        to: controlled ? 'user' : 'active',
        expected: row.status,
        lease: null,
        endedAt: null,
      },
      tx,
    );
  });
}
export async function sendSignal(
  input: BrowserControlInput,
  { controlled }: { controlled: boolean },
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
) {
  const text = controlled ? BROWSER_CONTROL_USER_TEXT : BROWSER_CONTROL_AGENT_TEXT;
  await client.beta.sessions.events.send(input.anthropicSessionId, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: `<browser_control state="${controlled ? 'user' : 'agent'}">${text}</browser_control>`,
          },
        ],
      },
    ],
  });
}
