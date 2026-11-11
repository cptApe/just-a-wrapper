import 'server-only';
import { z } from 'zod';
import { COMPOSIO_API_BASE, TOOL_ROUTER_SESSION_PATH } from '@/lib/composio/api';
import { IntegrationError } from '@/lib/errors';

// Composio shared connections: a SHARED account is created through a session link,
// reached only by pinning it into a session, and gated by a per-user allow list.
// Responses are parsed down to ids and status, so credential fields are never held.

const ACCOUNTS_PATH = '/api/v3.1/connected_accounts';
const TIMEOUT_MS = 10_000;

const linkSchema = z.object({ redirect_url: z.string().min(1), connected_account_id: z.string() });
const statusSchema = z.object({ status: z.string() });
const memberAccountsSchema = z.object({
  items: z.array(
    z.object({ user_id: z.string(), status: z.string(), toolkit: z.object({ slug: z.string() }) }),
  ),
  next_cursor: z.string().nullish(),
});

function accountUrl(accountId: string): string {
  return `${COMPOSIO_API_BASE}${ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`;
}

async function requireOk(response: Response, message: string, accountId: string): Promise<void> {
  if (response.ok) return;
  throw new IntegrationError('EXTERNAL_API_FAILED', message, {
    status: response.status,
    accountId,
    detail: (await response.text()).slice(0, 300),
  });
}

/** Open a sign-in link in a session. `shareWith` makes the new account SHARED. */
export async function createConnectLink(input: {
  sessionId: string;
  toolkit: string;
  apiKey: string;
  shareWith: readonly string[] | null;
}): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const response = await fetch(
    `${COMPOSIO_API_BASE}${TOOL_ROUTER_SESSION_PATH}/${encodeURIComponent(input.sessionId)}/link`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': input.apiKey },
      body: JSON.stringify({
        toolkit: input.toolkit,
        ...(input.shareWith === null
          ? {}
          : {
              experimental: {
                account_type: 'SHARED',
                acl_config_for_shared: { allowed_user_ids: input.shareWith },
              },
            }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio connect link failed', {
      status: response.status,
      toolkit: input.toolkit,
      detail: (await response.text()).slice(0, 300),
    });
  const parsed = linkSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio connect link response is invalid',
      { toolkit: input.toolkit },
      { cause: parsed.error },
    );
  return {
    redirectUrl: parsed.data.redirect_url,
    connectedAccountId: parsed.data.connected_account_id,
  };
}

/** The account's Composio status, or `GONE` once it no longer exists. */
export async function readAccountStatus(accountId: string, apiKey: string): Promise<string> {
  const response = await fetch(accountUrl(accountId), {
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return 'GONE';
  await requireOk(response, 'Composio shared account read failed', accountId);
  const parsed = statusSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio shared account response is invalid',
      { accountId },
      { cause: parsed.error },
    );
  return parsed.data.status;
}

/** Replace the allow list. Composio denies anyone absent from it, including other tenants. */
export async function setSharedAccountAccess(
  accountId: string,
  allowedUserIds: readonly string[],
  apiKey: string,
): Promise<void> {
  const response = await fetch(accountUrl(accountId), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      experimental: { acl_config_for_shared: { allowed_user_ids: allowedUserIds } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await requireOk(response, 'Composio shared account access update failed', accountId);
}

export async function deleteConnectedAccount(accountId: string, apiKey: string): Promise<void> {
  const response = await fetch(accountUrl(accountId), {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return;
  await requireOk(response, 'Composio shared account delete failed', accountId);
}

/** Toolkits where this member has their own active account. */
export async function listOwnActiveToolkits(
  composioUserId: string,
  apiKey: string,
): Promise<Set<string>> {
  const toolkits = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = new URL(`${COMPOSIO_API_BASE}${ACCOUNTS_PATH}`);
    url.searchParams.set('user_ids', composioUserId);
    url.searchParams.set('statuses', 'ACTIVE');
    url.searchParams.set('limit', '100');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok)
      throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio own accounts read failed', {
        status: response.status,
        composioUserId,
      });
    const parsed = memberAccountsSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new IntegrationError(
        'EXTERNAL_API_FAILED',
        'Composio own accounts response is invalid',
        { composioUserId },
        { cause: parsed.error },
      );
    for (const account of parsed.data.items) {
      if (account.user_id === composioUserId && account.status === 'ACTIVE')
        toolkits.add(account.toolkit.slug.toLowerCase());
    }
    cursor = parsed.data.next_cursor ?? null;
  } while (cursor !== null);
  return toolkits;
}
