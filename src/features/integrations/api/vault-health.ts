import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceMember } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { MCP_PROXY_CREDENTIAL_NAME } from '../constants';
import { signMemberToken } from '../jwt';
import { vaultCredentialKey } from '../lib/vault-credential-key';
import { proxyInitialize } from '../mcp-proxy-client';
import type { VaultHealth } from '../types';

const CREDENTIAL_LIST_TIMEOUT_MS = 5_000;
const PROXY_INITIALIZE_TIMEOUT_MS = 15_000;

export async function checkMemberVaultHealth(input: {
  organizationId: string;
  userId: string;
}): Promise<VaultHealth> {
  const member = (
    await db
      .select({
        vaultId: workspaceMember.mcpProxyVaultId,
        credentialKey: workspaceMember.vaultCredentialKey,
        composioUserId: workspaceMember.composioUserId,
      })
      .from(workspaceMember)
      .where(
        and(
          eq(workspaceMember.organizationId, input.organizationId),
          eq(workspaceMember.userId, input.userId),
        ),
      )
      .limit(1)
  ).at(0);

  if (!member?.vaultId) return { status: 'unprovisioned' };

  const { connectedApps } = capabilities;
  if (connectedApps.kind === 'off') return { status: 'unprovisioned' };
  const { proxyUrl, jwtSecret } = connectedApps;

  if (member.credentialKey !== vaultCredentialKey(jwtSecret))
    return { status: 'broken', reason: 'credential-missing' };

  const client = getAnthropicClient();
  if (!client) return { status: 'unprovisioned' };

  let credentialFound = false;
  try {
    for await (const credential of client.beta.vaults.credentials.list(member.vaultId, undefined, {
      timeout: CREDENTIAL_LIST_TIMEOUT_MS,
      maxRetries: 0,
    })) {
      if (
        credential.display_name === MCP_PROXY_CREDENTIAL_NAME &&
        credential.archived_at === null &&
        credential.auth.type === 'static_bearer' &&
        credential.auth.mcp_server_url === proxyUrl
      ) {
        credentialFound = true;
        break;
      }
    }
  } catch (error) {
    if (error instanceof APIError && error.status === 404)
      return { status: 'broken', reason: 'credential-missing' };
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Anthropic vault credential lookup failed',
      { ...input, vaultId: member.vaultId },
      { cause: error },
    );
  }
  if (!credentialFound) return { status: 'broken', reason: 'credential-missing' };

  // The key fingerprint checks the stored token; this probe checks proxy availability.
  const token = await signMemberToken(member.composioUserId, jwtSecret, '5m');
  try {
    await proxyInitialize(proxyUrl, token, {
      clientName: 'vault-health-probe',
      timeoutMs: PROXY_INITIALIZE_TIMEOUT_MS,
    });
  } catch (error) {
    captureException(error, { op: 'probe-mcp-proxy', ...input });
    // A fresh-token probe cannot diagnose a broken stored credential. Cold
    // starts and upstream outages are inconclusive, and reconnect cannot fix them.
    return { status: 'unknown', reason: 'proxy-unreachable' };
  }
  return { status: 'healthy' };
}
