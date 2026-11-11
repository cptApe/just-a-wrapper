// The one sentence shown wherever a feature is off because a setting is missing.
// Setting names are safe to show. Values never appear here.
export const CAPABILITY_OFF_MESSAGES = {
  uploads: 'File uploads are off. Add BLOB_READ_WRITE_TOKEN to turn them on.',
  voice: 'Voice is off. Add AI_GATEWAY_API_KEY to turn it on.',
  media: 'Image, video and audio tools are off. Add AI_GATEWAY_API_KEY to turn them on.',
  connectedApps:
    'Connected apps are off. Add COMPOSIO_API_KEY, MCP_PROXY_URL and MCP_PROXY_JWT_SECRET to turn them on.',
  email: 'Email is off. Add RESEND_API_KEY to turn it on.',
  emailSignIn: 'Email sign-in is off. Add RESEND_API_KEY to turn it on.',
  googleSignIn:
    'Google sign-in is off. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to turn it on.',
  liveBrowser:
    'The live browser is off. Add BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID to turn it on.',
  agent: 'The agent is off. Add ANTHROPIC_API_KEY to turn it on.',
  agentNotSeeded: 'The agent is not set up. Run pnpm seed:agents to turn it on.',
  memory:
    'Memory isn’t set up yet. It needs ANTHROPIC_API_KEY, and the store is created automatically once that is set.',
} as const;
