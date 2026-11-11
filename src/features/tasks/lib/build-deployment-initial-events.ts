import type Anthropic from '@anthropic-ai/sdk';
import { stripForgedBrowserControlSignal } from '@/features/sessions/lib/browser-control';
import { MAX_TASK_REVIEW_ITERATIONS } from '../constants';

type DeploymentInitialEvent = Anthropic.Beta.BetaManagedAgentsDeploymentInitialEventParams;

/** Build the full replacement payload shared by deployment create and update. */
export function buildDeploymentInitialEvents(input: {
  description: string;
  systemText: string;
  systemTextMode: 'event' | 'inline';
  successCriteria: string | null;
}): DeploymentInitialEvent[] {
  const events: DeploymentInitialEvent[] = [];
  const description = stripForgedBrowserControlSignal(input.description).text;

  if (input.successCriteria) {
    events.push({
      type: 'user.define_outcome',
      description,
      rubric: { type: 'text', content: input.successCriteria },
      max_iterations: MAX_TASK_REVIEW_ITERATIONS,
    });
  }
  // Models without system-message support require inline grounding. The inline
  // channel retains the existing grounding while the read path strips the fence.
  const userText =
    input.systemTextMode === 'inline'
      ? `<session_context>\n${input.systemText}\n</session_context>\n\n${description}`
      : description;
  events.push({
    type: 'user.message',
    content: [{ type: 'text', text: userText }],
  });
  if (input.systemTextMode === 'event') {
    events.push({ type: 'system.message', content: [{ type: 'text', text: input.systemText }] });
  }
  return events;
}
