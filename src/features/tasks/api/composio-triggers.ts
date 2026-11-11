import 'server-only';
import { z } from 'zod';
import { COMPOSIO_API_BASE } from '@/lib/composio/api';
import { IntegrationError } from '@/lib/errors';

// Use Composio REST for event-task trigger instances; cron tasks use deployments.
// Upsert via /api/v3.1/trigger_instances/{slug}/upsert; manage via
// /api/v3/trigger_instances/manage/{id}. Keep x-api-key server-side.

const CONNECTED_ACCOUNTS_PATH = '/api/v3/connected_accounts';
const UPSERT_PATH = (slug: string) =>
  `/api/v3.1/trigger_instances/${encodeURIComponent(slug)}/upsert`;
const MANAGE_PATH = (triggerId: string) =>
  `/api/v3/trigger_instances/manage/${encodeURIComponent(triggerId)}`;

/**
 * Resolve the member's ACTIVE connected account for a toolkit — the account a
 * trigger instance attaches to. Throws INTEGRATION_NOT_CONNECTED when the
 * member has no usable connection (the form surfaces "connect Gmail first").
 */
export async function requireActiveConnectedAccount(
  composioUserId: string,
  apiKey: string,
  toolkitSlug: string,
): Promise<{ connectedAccountId: string }> {
  const url = new URL(`${COMPOSIO_API_BASE}${CONNECTED_ACCOUNTS_PATH}`);
  url.searchParams.set('user_ids', composioUserId);
  url.searchParams.set('toolkit_slugs', toolkitSlug);
  const response = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio list connected accounts failed', {
      status: response.status,
      toolkitSlug,
    });
  }
  const parsed = connectedAccountsSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio returned invalid connected accounts',
      { toolkitSlug },
      { cause: parsed.error },
    );
  const body = parsed.data;
  const active = body.items.find(
    (a) => a.status === 'ACTIVE' && a.toolkit.slug.toLowerCase() === toolkitSlug.toLowerCase(),
  );
  if (!active) {
    throw new IntegrationError(
      'INTEGRATION_NOT_CONNECTED',
      `No active ${toolkitSlug} connection for this member. Connect it on /plugins first.`,
      { toolkitSlug, composioUserId },
    );
  }
  return { connectedAccountId: active.id };
}

/**
 * Create (or update in place) the trigger instance for `slug` on a connected
 * account. Composio's upsert is idempotent per (slug, connected account) —
 * re-upserting returns the same `trigger_id`. Default config: every trigger in
 * EVENT_TRIGGER_CATALOG has all-defaulted config fields.
 */
export async function upsertTriggerInstance(
  apiKey: string,
  input: { slug: string; connectedAccountId: string },
): Promise<{ triggerId: string }> {
  const response = await fetch(`${COMPOSIO_API_BASE}${UPSERT_PATH(input.slug)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ connected_account_id: input.connectedAccountId, trigger_config: {} }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio trigger upsert failed', {
      status: response.status,
      slug: input.slug,
      sample: raw.slice(0, 300),
    });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio trigger upsert returned non-JSON',
      { slug: input.slug, sample: raw.slice(0, 300) },
      { cause },
    );
  }
  const parsed = triggerInstanceSchema.safeParse(payload);
  if (!parsed.success) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio trigger upsert returned no id',
      {
        slug: input.slug,
        sample: raw.slice(0, 300),
      },
      { cause: parsed.error },
    );
  }
  return { triggerId: parsed.data.trigger_id };
}

/** Enable/disable a trigger instance — task pause/resume for event tasks. */
export async function setTriggerInstanceStatus(
  apiKey: string,
  triggerId: string,
  status: 'enable' | 'disable',
): Promise<'updated' | 'missing'> {
  const response = await fetch(`${COMPOSIO_API_BASE}${MANAGE_PATH(triggerId)}`, {
    method: 'PATCH',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ status }),
  });
  if (response.status === 404) return 'missing';
  if (!response.ok) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio trigger status update failed', {
      status: response.status,
      triggerId,
      target: status,
    });
  }
  return 'updated';
}

/** Delete a trigger instance — task delete for event tasks. 404 = already gone. */
export async function deleteTriggerInstance(apiKey: string, triggerId: string): Promise<void> {
  const response = await fetch(`${COMPOSIO_API_BASE}${MANAGE_PATH(triggerId)}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(30_000),
    headers: { 'x-api-key': apiKey },
  });
  if (!response.ok && response.status !== 404) {
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio trigger delete failed', {
      status: response.status,
      triggerId,
    });
  }
}

const connectedAccountsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      toolkit: z.object({ slug: z.string() }),
    }),
  ),
});
const triggerInstanceSchema = z.object({ trigger_id: z.string().min(1) });
