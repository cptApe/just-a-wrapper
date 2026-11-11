import type { CaptureIdentity } from '@/lib/analytics';

// Only user-originated sends count as product activity; scripted and billing-resume
// messages are app actions.
export type MessageOrigin = 'user' | 'system';

export type MessageSendFacts = {
  origin: MessageOrigin;
  opening?: { workspaceId: string; userId: string };
  hasEcho: boolean;
};

export function messageSendCapture(
  facts: MessageSendFacts,
): { props: Record<string, unknown>; identity: CaptureIdentity } | null {
  if (facts.origin !== 'user') return null;
  return {
    props: {
      is_opening: Boolean(facts.opening),
      has_echo: facts.hasEcho,
    },
    identity: {
      userId: facts.opening?.userId,
      workspaceId: facts.opening?.workspaceId,
    },
  };
}
