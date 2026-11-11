'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { toolRequest } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';

// Persist missing-app requests in tool_request; operators read them from the database.

const RequestAppInput = z.object({
  message: z.string().trim().min(1).max(2000),
});

export async function submitAppRequest(input: { message: string }): Promise<void> {
  return withRequestContext({ route: 'tools/request-app', feature: 'integrations' }, async () => {
    const parsed = RequestAppInput.parse(input);
    const caller = await resolveCaller(await headers());
    await db.insert(toolRequest).values({
      organizationId: caller.organizationId,
      userId: caller.userId,
      message: parsed.message,
    });
  });
}
