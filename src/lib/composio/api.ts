// Composio REST base. The proxy mints sessions with a raw fetch (no SDK in the
// hot path) at POST {base}/api/v3.1/tool_router/session.
export const COMPOSIO_API_BASE = 'https://backend.composio.dev';
export const TOOL_ROUTER_SESSION_PATH = '/api/v3.1/tool_router/session';
