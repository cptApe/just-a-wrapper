import type { getAnthropicClient } from '@/features/agents';
import { ToolError } from '@/lib/errors';
import {
  type BrowserControlInput,
  readControlled,
  sendSignal,
  setControlled,
} from './browser-control-state';

export async function applyBrowserControlTransition(
  currentControlled: boolean,
  input: BrowserControlInput,
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
): Promise<boolean> {
  if (currentControlled === input.controlledByUser) return false;
  const changed = await setControlled(input, {
    controlled: input.controlledByUser,
    expectedCurrent: currentControlled,
  });
  if (!changed && (await readControlled(input)) === input.controlledByUser) return false;
  if (!changed)
    throw new ToolError('CONFLICT', 'Browser control changed concurrently', {
      sessionRowId: input.sessionRowId,
    });
  // The ownership fence is authoritative even if notification fails. Releasing it here
  // could let a second action start while the action interrupted by takeover still runs.
  await sendSignal(input, { controlled: input.controlledByUser }, client);
  return true;
}
