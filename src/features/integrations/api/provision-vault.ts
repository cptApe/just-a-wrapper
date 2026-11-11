import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/features/agents';
import { AppError, IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { signMemberToken } from '../jwt';
import { vaultCredentialKey } from '../lib/vault-credential-key';
import { rotateMemberVaultCredential } from './rotate-member-vault';
import {
  attachClaimedVault,
  claimMemberVault,
  finishMemberVault,
  readMemberVault,
} from './vault-transitions';

const REQUEST_OPTIONS = { timeout: 10_000, maxRetries: 0 } as const;
const RENEW_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function ensureMemberVault(input: {
  organizationId: string;
  userId: string;
  refreshCredential: boolean;
}): Promise<string | null> {
  const client = getAnthropicClient();
  const { connectedApps } = capabilities;
  if (client === null || connectedApps.kind === 'off') return null;
  const { proxyUrl, jwtSecret } = connectedApps;
  const existing = await readMemberVault(input);
  if (existing === null) return null;
  if (
    existing.status === 'provisioned' &&
    existing.credentialKey === vaultCredentialKey(jwtSecret) &&
    existing.credentialUpdatedAt !== null &&
    existing.credentialUpdatedAt.getTime() > Date.now() - RENEW_AFTER_MS &&
    !input.refreshCredential
  )
    return existing.vaultId;
  const claimedAt = new Date();
  const claim = await claimMemberVault(input, claimedAt);
  // Sessions re-resolve credentials on the same vault as rotation completes.
  if (claim === null && existing.vaultId !== null) return existing.vaultId;
  if (claim === null)
    throw new AppError('CONFLICT', 'Member vault provisioning is already in progress', input);
  try {
    const vaultId = await resolveVault(client, { ...input, ...claim });
    if (!(await attachClaimedVault({ ...input, claimedAt, vaultId }))) {
      if ((await readMemberVault(input)) === null)
        await client.beta.vaults.archive(vaultId, undefined, REQUEST_OPTIONS);
      throw new AppError('CONFLICT', 'Member vault claim was lost before attachment', input);
    }
    const token = await signMemberToken(claim.composioUserId, jwtSecret);
    await rotateMemberVaultCredential({
      client,
      vaultId,
      token,
      proxyUrl,
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (
      !(await finishMemberVault({
        ...input,
        claimedAt,
        status: 'provisioned',
        credentialUpdatedAt: new Date(),
        credentialKey: vaultCredentialKey(jwtSecret),
      }))
    )
      throw new AppError('CONFLICT', 'Member vault claim was lost before completion', input);
    return vaultId;
  } catch (cause) {
    // A failed renewal must not disable a previously working vault.
    if (existing.status === 'provisioned' && existing.vaultId !== null) {
      await finishMemberVault({
        ...input,
        claimedAt,
        status: 'provisioned',
        credentialUpdatedAt: existing.credentialUpdatedAt,
        credentialKey: existing.credentialKey,
      });
      if (existing.credentialKey !== vaultCredentialKey(jwtSecret))
        throw new IntegrationError(
          'EXTERNAL_API_FAILED',
          'Member vault signing key rotation failed',
          input,
          { cause },
        );
      captureException(cause, { op: 'vault-renewal', ...input });
      return existing.vaultId;
    }
    await finishMemberVault({
      ...input,
      claimedAt,
      status: 'unprovisioned',
      credentialUpdatedAt: null,
      credentialKey: null,
    });
    if (cause instanceof AppError) throw cause;
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Member vault provisioning failed', input, {
      cause,
    });
  }
}

async function resolveVault(
  client: NonNullable<ReturnType<typeof getAnthropicClient>>,
  input: {
    organizationId: string;
    userId: string;
    composioUserId: string;
    vaultId: string | null;
  },
): Promise<string> {
  if (input.vaultId !== null) {
    try {
      const existing = await client.beta.vaults.retrieve(input.vaultId, undefined, REQUEST_OPTIONS);
      if (existing.archived_at === null) return existing.id;
    } catch (cause) {
      if (!(cause instanceof APIError && cause.status === 404)) throw cause;
    }
  }
  // The persisted member claim serializes first creation; cleanup discovers crash orphans.
  const vault = await client.beta.vaults.create(
    {
      display_name: `member ${input.composioUserId}`,
      metadata: {
        organization_id: input.organizationId,
        user_id: input.userId,
        composio_user_id: input.composioUserId,
      },
    },
    REQUEST_OPTIONS,
  );
  return vault.id;
}

export async function isMemberVaultProvisioned(input: {
  organizationId: string;
  userId: string;
}): Promise<boolean> {
  const { connectedApps } = capabilities;
  if (getAnthropicClient() === null || connectedApps.kind === 'off') return true;
  const member = await readMemberVault(input);
  return (
    member !== null &&
    member.status === 'provisioned' &&
    member.credentialKey === vaultCredentialKey(connectedApps.jwtSecret) &&
    member.credentialUpdatedAt !== null &&
    member.credentialUpdatedAt.getTime() > Date.now() - RENEW_AFTER_MS
  );
}
