import { z } from 'zod';
import { COMPOSIO_API_BASE } from '@/lib/composio/api';
import { IntegrationError } from '@/lib/errors';
import { assertBeforeDeadline } from '@/lib/sweep-deadline';

const pageSchema = z.object({
  items: z.array(z.object({ id: z.string(), user_id: z.string() })),
  next_cursor: z.string().nullish(),
});

export async function deleteMemberAccounts(
  composioUserId: string,
  apiKey: string,
  deadline: number,
): Promise<void> {
  let cursor: string | null = null;
  do {
    assertBeforeDeadline(
      deadline,
      'Member account cleanup deadline reached; pending work will retry',
      { composioUserId },
    );
    const url = new URL(`${COMPOSIO_API_BASE}/api/v3/connected_accounts`);
    url.searchParams.set('user_ids', composioUserId);
    // The default listing is private accounts only; workspace identities own shared ones.
    url.searchParams.set('account_type', 'ALL');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Member connected accounts could not be listed',
        { composioUserId, status: response.status },
      );
    const parsed = pageSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Member connected accounts response is invalid',
        { composioUserId },
        { cause: parsed.error },
      );
    for (const account of parsed.data.items) {
      if (account.user_id !== composioUserId) continue;
      assertBeforeDeadline(
        deadline,
        'Member account cleanup deadline reached; pending work will retry',
        { composioUserId },
      );
      const removed = await fetch(
        `${COMPOSIO_API_BASE}/api/v3/connected_accounts/${encodeURIComponent(account.id)}`,
        { method: 'DELETE', headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) },
      );
      if (!removed.ok && removed.status !== 404)
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Member connected account could not be deleted',
          { composioUserId, accountId: account.id, status: removed.status },
        );
    }
    cursor = parsed.data.next_cursor ?? null;
  } while (cursor !== null);
}
