'use server';
import { headers } from 'next/headers';
import { z } from 'zod';
import { loadSessionStatus } from '@/features/sessions';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
export async function loadChatStatus(sessionId: string) {
  return withRequestContext({ route: 'chat-status' }, async () => {
    const { workspaceId, userId } = await resolveCaller(await headers());
    return loadSessionStatus({
      sessionId: z.string().uuid().parse(sessionId),
      workspaceId,
      viewerId: userId,
    });
  });
}
