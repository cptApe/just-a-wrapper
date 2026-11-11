import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceMember } from '@/db/schema';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import 'server-only';
import { notify } from './notify';

/**
 * Resolve Anthropic's persisted per-member vault id and notify only its owner.
 * Our proxy credential is static_bearer and cannot refresh-fail; this event is
 * for mcp_oauth credentials an admin may add to the same vault.
 */
export async function notifyVaultCredentialRefreshFailed(input: {
  credentialId: string;
  vaultId: string;
  webhookEventId: string;
}): Promise<{ handled: boolean; userId: string | null }> {
  const member = (
    await db
      .select({
        organizationId: workspaceMember.organizationId,
        userId: workspaceMember.userId,
      })
      .from(workspaceMember)
      .where(eq(workspaceMember.mcpProxyVaultId, input.vaultId))
      .limit(1)
  ).at(0);
  if (!member) {
    shipLog({
      level: 'warn',
      msg: 'vault_credential.refresh_failed.unknown_vault',
      feature: 'notifications',
      op: 'notify-vault-credential-refresh-failed',
      vault_id: input.vaultId,
      credential_id: input.credentialId,
      webhook_event_id: input.webhookEventId,
    });
    return { handled: false, userId: null };
  }

  await notify('integration.broken', {
    organizationId: member.organizationId,
    recipientUserIds: [member.userId],
    idempotencyKey: `vault-credential-refresh-failed:${input.webhookEventId}`,
    data: {
      title: 'Connection needs attention',
      body: 'An agent connection stopped working. Open Tools to check your connections.',
    },
  }).catch((error) =>
    captureException(error, {
      feature: 'notifications',
      op: 'notify-vault-credential-refresh-failed',
    }),
  );
  shipLog({
    level: 'warn',
    msg: 'vault_credential.refresh_failed.notified',
    feature: 'notifications',
    op: 'notify-vault-credential-refresh-failed',
    vault_id: input.vaultId,
    credential_id: input.credentialId,
    webhook_event_id: input.webhookEventId,
    user_id: member.userId,
  });
  return { handled: true, userId: member.userId };
}
