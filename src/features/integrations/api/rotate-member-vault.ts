import type { BetaManagedAgentsCredential } from '@anthropic-ai/sdk/resources/beta/vaults/credentials';
import type { getAnthropicClient } from '@/features/agents';
import { IntegrationError } from '@/lib/errors';
import { MCP_PROXY_CREDENTIAL_NAME } from '../constants';

const VAULT_SDK_REQUEST_OPTIONS = { timeout: 10_000, maxRetries: 0 } as const;

export async function rotateMemberVaultCredential(input: {
  client: NonNullable<ReturnType<typeof getAnthropicClient>>;
  vaultId: string;
  token: string;
  proxyUrl: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  const credentials = input.client.beta.vaults.credentials;
  try {
    const active: BetaManagedAgentsCredential[] = [];
    for await (const credential of credentials.list(
      input.vaultId,
      undefined,
      VAULT_SDK_REQUEST_OPTIONS,
    )) {
      if (
        credential.display_name === MCP_PROXY_CREDENTIAL_NAME &&
        credential.archived_at === null
      ) {
        active.push(credential);
      }
    }

    const matching = active.find(
      (credential) =>
        credential.auth.type === 'static_bearer' &&
        credential.auth.mcp_server_url === input.proxyUrl,
    );
    if (matching) {
      await credentials.update(
        matching.id,
        {
          vault_id: input.vaultId,
          auth: { type: 'static_bearer', token: input.token },
        },
        VAULT_SDK_REQUEST_OPTIONS,
      );
    } else {
      await credentials.create(
        input.vaultId,
        {
          auth: {
            type: 'static_bearer',
            token: input.token,
            mcp_server_url: input.proxyUrl,
          },
          display_name: MCP_PROXY_CREDENTIAL_NAME,
        },
        VAULT_SDK_REQUEST_OPTIONS,
      );
    }

    // Create-before-archive is deliberate: Reconnect never leaves the member
    // with zero active credentials. If an archive fails mid-loop, duplicates
    // may briefly remain; the next lock-serialized Reconnect converges them.
    for (const credential of active) {
      if (credential.id !== matching?.id) {
        await credentials.archive(
          credential.id,
          { vault_id: input.vaultId },
          VAULT_SDK_REQUEST_OPTIONS,
        );
      }
    }
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Failed to rotate the member MCP-proxy credential',
      {
        organizationId: input.organizationId,
        userId: input.userId,
        vaultId: input.vaultId,
      },
      { cause },
    );
  }
}
