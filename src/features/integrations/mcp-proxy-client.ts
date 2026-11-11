import 'server-only';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { IntegrationError } from '@/lib/errors';

// A minimal MCP client that drives OUR proxy the way Anthropic's container does:
// streamable-HTTP transport with `Authorization: Bearer <member JWT>`. Used by
// the vault-health probe (initialize) and the Composio connection actions
// (tools/call). Server-only — it signs/holds a member JWT.
//
// The official @modelcontextprotocol/sdk transport accepts `requestInit.headers`,
// which is how we attach the Bearer the proxy verifies.

function buildClient(
  url: string,
  jwt: string,
  clientName = 'mcp-proxy',
): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const client = new Client({ name: clientName, version: '0.0.0' });
  return { client, transport };
}

// initialize-only probe through the same authenticated transport Anthropic's
// container uses. Health checks do not need the heavier tools/list round-trip.
export async function proxyInitialize(
  url: string,
  jwt: string,
  options: { clientName: string; timeoutMs: number },
): Promise<void> {
  const { client, transport } = buildClient(url, jwt, options.clientName);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new IntegrationError('EXTERNAL_API_FAILED', 'MCP proxy initialize probe timed out', {
            clientName: options.clientName,
            timeoutMs: options.timeoutMs,
          }),
        ),
      options.timeoutMs,
    );
  });
  try {
    await Promise.race([
      client.connect(transport, {
        signal: AbortSignal.timeout(options.timeoutMs),
        timeout: options.timeoutMs,
        maxTotalTimeout: options.timeoutMs,
      }),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await transport.close();
  }
}

// initialize + tools/call through the proxy. Returns the raw content blocks.
export async function proxyCallTool(
  url: string,
  jwt: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { client, transport } = buildClient(url, jwt);
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    return result.content;
  } finally {
    await transport.close();
  }
}
