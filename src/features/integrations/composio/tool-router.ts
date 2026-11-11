import 'server-only';
import { z } from 'zod';
import { COMPOSIO_API_BASE, TOOL_ROUTER_SESSION_PATH } from '@/lib/composio/api';
import { COMPOSIO_TOOLKIT_ALLOWLIST, type ToolkitSlug } from '@/lib/composio/toolkits';
import { IntegrationError } from '@/lib/errors';
import composioToolAllowlist from '../data/composio-tool-allowlist.json';

// Mint only the per-toolkit tools in the allowlist.
// REST requires { enable: [...] }, not array shorthand. Typing requires every
// allowed toolkit to have a list.
const COMPOSIO_TOOL_ALLOWLIST: Record<ToolkitSlug, readonly string[]> = composioToolAllowlist;
const ENABLED_TOOLS_CONFIG = Object.fromEntries(
  Object.entries(COMPOSIO_TOOL_ALLOWLIST).map(([slug, tools]) => [slug, { enable: tools }]),
);
const TOOL_ROUTER_MINT_TIMEOUT_MS = 10_000;

// Mint Tool Router sessions with one REST fetch to keep the proxy graph small.
// POST /api/v3.1/tool_router/session with x-api-key returns the member MCP URL.
// Forwarding still requires x-api-key because the URL is not self-authenticating.

export type MintedSession = { sessionId: string; mcpUrl: string };

/** Toolkit slug to the one shared connected account pinned for that toolkit. */
export type SharedAccountPins = Record<string, string>;

export async function mintToolRouterSession(
  composioUserId: string,
  apiKey: string,
  sharedAccountPins: SharedAccountPins,
): Promise<MintedSession> {
  // No auth_configs pinning: connect links are minted by the session itself
  // (composio/connect.ts → MANAGE_CONNECTIONS), so connections always land on
  // whatever auth config the session resolves — aligned by construction.
  let res: Response;
  try {
    res = await fetch(`${COMPOSIO_API_BASE}${TOOL_ROUTER_SESSION_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        user_id: composioUserId,
        toolkits: { enable: [...COMPOSIO_TOOLKIT_ALLOWLIST] },
        tools: ENABLED_TOOLS_CONFIG,
        // A pin is an exact per-toolkit override; unpinned toolkits still resolve by user id.
        ...(Object.keys(sharedAccountPins).length > 0
          ? {
              connected_accounts: Object.fromEntries(
                Object.entries(sharedAccountPins).map(([toolkit, account]) => [toolkit, [account]]),
              ),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(TOOL_ROUTER_MINT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio Tool Router mint request failed',
      { composioUserId, timeoutMs: TOOL_ROUTER_MINT_TIMEOUT_MS },
      { cause },
    );
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new IntegrationError('EXTERNAL_API_FAILED', 'Composio Tool Router mint failed', {
      status: res.status,
      detail: detail.slice(0, 500),
    });
  }

  const parsed = z
    .object({ session_id: z.string().min(1), mcp: z.object({ url: z.string().min(1) }) })
    .safeParse(await res.json());
  if (!parsed.success) {
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Composio mint response missing session_id / mcp.url',
      {},
      { cause: parsed.error },
    );
  }
  return { sessionId: parsed.data.session_id, mcpUrl: parsed.data.mcp.url };
}
