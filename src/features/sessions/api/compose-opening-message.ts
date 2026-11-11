import 'server-only';
import { composeSessionStartUserText } from '../lib/session-context';
import { resolveSessionStartGrounding } from './resolve-session-grounding';

export async function composeOpeningMessage(input: {
  text: string;
  userId: string;
  workspaceId: string;
  organizationId: string;
}): Promise<string> {
  const grounding = await resolveSessionStartGrounding({
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  return composeSessionStartUserText({
    now: new Date(),
    timeZone: grounding.timeZone,
    userText: input.text,
    displayName: grounding.displayName,
    workspaceName: grounding.workspaceName,
    replyLanguage: grounding.replyLanguage,
  });
}
