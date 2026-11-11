import 'server-only';
import { z } from 'zod';
import { COMPOSIO_API_BASE } from '@/lib/composio/api';
import { IntegrationError } from '@/lib/errors';

const accountsSchema = z.object({
  items: z
    .array(z.object({ id: z.string(), toolkit: z.object({ slug: z.string() }) }))
    .nullish()
    .transform((items) => items ?? []),
  next_cursor: z.string().nullish(),
});

/** Every page is scoped to this member; partial failure retains the disconnect claim for retry. */
export async function disconnectToolkitAccounts(
  composioUserId: string,
  apiKey: string,
  toolkitSlug: string,
): Promise<{ removed: number }> {
  let cursor: string | null = null;
  let removed = 0;
  do {
    const url = new URL(`${COMPOSIO_API_BASE}/api/v3/connected_accounts`);
    url.searchParams.set('user_ids', composioUserId);
    url.searchParams.set('toolkit_slugs', toolkitSlug);
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio list connected accounts failed', {
        status: response.status,
        toolkitSlug,
      });
    const parsed = accountsSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Composio connected accounts response is invalid',
        { toolkitSlug },
        { cause: parsed.error },
      );
    for (const account of parsed.data.items) {
      // The API filter is not sufficient authorization for a different toolkit.
      if (account.toolkit.slug.toLowerCase() !== toolkitSlug.toLowerCase()) continue;
      const response = await fetch(
        `${COMPOSIO_API_BASE}/api/v3/connected_accounts/${encodeURIComponent(account.id)}`,
        { method: 'DELETE', headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok && response.status !== 404)
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Composio delete connected account failed',
          { status: response.status, toolkitSlug, accountId: account.id },
        );
      if (response.ok) removed += 1;
    }
    cursor = parsed.data.next_cursor ?? null;
  } while (cursor !== null);
  return { removed };
}
