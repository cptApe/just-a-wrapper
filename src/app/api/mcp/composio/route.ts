// The Composio MCP proxy — the MCP endpoint Anthropic's agent container
// targets. A route does nothing: it wires request context, resolves config, and
// delegates to features/integrations (proxy.ts). All proxy logic lives there.
//
// Stateless thin passthrough (NOT mcp-handler): verify inbound Bearer JWT →
// resolve the member's Tool Router URL → forward JSON-RPC with x-api-key →
// stream the upstream response back verbatim. See docs/spec/02-foundation.md.

import { forwardMcpRequest, proxyConfig } from '@/features/integrations/server';
import { AppError } from '@/lib/errors';
import { ROUTE_ERROR_MESSAGES } from '@/lib/route-error-messages';
import { withApiRoute } from '@/lib/route-kit';

// JWT verification (jose) needs the Node.js runtime. Long SSE forwards bill
// wall-clock time, so maxDuration is an explicit ceiling.
export const runtime = 'nodejs';
export const maxDuration = 300;

function jsonRpcError(status: number, message: string): Response {
  // The caller speaks JSON-RPC; answer config/auth failures in its own envelope
  // so an MCP client surfaces a clean error rather than HTML.
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function statusFor(error: unknown): number {
  if (error instanceof AppError) {
    if (error.code === 'WEBHOOK_SIGNATURE_INVALID' || error.code === 'INTEGRATION_NOT_CONNECTED') {
      return 401;
    }
    if (error.code === 'EXTERNAL_API_FAILED') {
      return 502;
    }
  }
  return 500;
}

const boundary = {
  route: 'api/mcp/composio',
  feature: 'integrations',
  errorResponse(error: unknown) {
    return jsonRpcError(
      statusFor(error),
      error instanceof AppError ? ROUTE_ERROR_MESSAGES[error.code] : 'MCP proxy failed',
    );
  },
};
export const POST = withApiRoute(boundary, async (request) => {
  const configuration = proxyConfig();
  // 503 means the dependency is unconfigured, not broken.
  if (!configuration)
    return jsonRpcError(
      503,
      'MCP proxy not configured (missing COMPOSIO_API_KEY / MCP_PROXY_JWT_SECRET)',
    );
  return forwardMcpRequest(request, configuration);
});
// MCP requires JSON-RPC envelopes for unsupported stream and termination methods.
export const GET = withApiRoute(boundary, async () => jsonRpcError(405, 'Method not allowed.'));
export const DELETE = withApiRoute(boundary, async () => jsonRpcError(405, 'Method not allowed.'));
