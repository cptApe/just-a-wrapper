import { AppError } from './errors';

export type MediaCapability = { kind: 'off' } | { kind: 'gateway'; apiKey: string };

export type Capabilities = {
  googleSignIn: { kind: 'google'; clientId: string; clientSecret: string } | { kind: 'off' };
  email: { kind: 'resend'; apiKey: string } | { kind: 'console' } | { kind: 'off' };
  media: MediaCapability;
  webSearch: { kind: 'exa'; apiKey: string } | { kind: 'anthropic' };
  browser: { kind: 'browserbase'; apiKey: string; projectId: string } | { kind: 'sandbox' };
  billing: { kind: 'stripe'; secretKey: string } | { kind: 'off' };
  connectedApps:
    | { kind: 'composio'; apiKey: string; proxyUrl: string; jwtSecret: string }
    | { kind: 'off' };
  storage: { kind: 'vercel-blob'; token: string } | { kind: 'off' };
};

// Pure configuration resolution lets seed dry runs work without the app's env validation.
type CapabilityEnv = {
  GOOGLE_CLIENT_ID: string | undefined;
  GOOGLE_CLIENT_SECRET: string | undefined;
  NODE_ENV: string | undefined;
  RESEND_API_KEY: string | undefined;
  AI_GATEWAY_API_KEY: string | undefined;
  EXA_API_KEY: string | undefined;
  BROWSERBASE_API_KEY: string | undefined;
  BROWSERBASE_PROJECT_ID: string | undefined;
  STRIPE_SECRET_KEY: string | undefined;
  COMPOSIO_API_KEY: string | undefined;
  MCP_PROXY_URL: string | undefined;
  MCP_PROXY_JWT_SECRET: string | undefined;
  BLOB_READ_WRITE_TOKEN: string | undefined;
};

// The one place environment values become capabilities. The runtime, the seed
// script and the drift check all call it, so their plans cannot differ.
export function resolveCapabilitiesFromEnv(
  source: Partial<Record<keyof CapabilityEnv, string | undefined>>,
): Capabilities {
  return resolveCapabilities({
    GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
    NODE_ENV: source.NODE_ENV,
    RESEND_API_KEY: source.RESEND_API_KEY,
    AI_GATEWAY_API_KEY: source.AI_GATEWAY_API_KEY,
    EXA_API_KEY: source.EXA_API_KEY,
    BROWSERBASE_API_KEY: source.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: source.BROWSERBASE_PROJECT_ID,
    STRIPE_SECRET_KEY: source.STRIPE_SECRET_KEY,
    COMPOSIO_API_KEY: source.COMPOSIO_API_KEY,
    MCP_PROXY_URL: source.MCP_PROXY_URL,
    MCP_PROXY_JWT_SECRET: source.MCP_PROXY_JWT_SECRET,
    BLOB_READ_WRITE_TOKEN: source.BLOB_READ_WRITE_TOKEN,
  });
}

export function resolveCapabilities(input: CapabilityEnv): Capabilities {
  const {
    EXA_API_KEY: exaApiKey,
    BROWSERBASE_API_KEY: browserbaseApiKey,
    BROWSERBASE_PROJECT_ID: browserbaseProjectId,
  } = input;
  if (Boolean(browserbaseApiKey) !== Boolean(browserbaseProjectId)) {
    const missingKey = browserbaseApiKey ? 'BROWSERBASE_PROJECT_ID' : 'BROWSERBASE_API_KEY';
    throw new AppError('VALIDATION_FAILED', `Browserbase configuration requires ${missingKey}`, {
      missingKey,
    });
  }
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = input;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    const missingKey = clientId ? 'GOOGLE_CLIENT_SECRET' : 'GOOGLE_CLIENT_ID';
    throw new AppError('VALIDATION_FAILED', `Google sign-in configuration requires ${missingKey}`, {
      missingKey,
    });
  }
  const {
    COMPOSIO_API_KEY: composioApiKey,
    MCP_PROXY_URL: proxyUrl,
    MCP_PROXY_JWT_SECRET: jwtSecret,
  } = input;
  if (composioApiKey && (!proxyUrl || !jwtSecret)) {
    const missingKey = proxyUrl ? 'MCP_PROXY_JWT_SECRET' : 'MCP_PROXY_URL';
    throw new AppError('VALIDATION_FAILED', `Connected apps configuration requires ${missingKey}`, {
      missingKey,
    });
  }
  return {
    googleSignIn:
      clientId && clientSecret ? { kind: 'google', clientId, clientSecret } : { kind: 'off' },
    email: input.RESEND_API_KEY
      ? { kind: 'resend', apiKey: input.RESEND_API_KEY }
      : { kind: input.NODE_ENV === 'development' ? 'console' : 'off' },
    media: input.AI_GATEWAY_API_KEY
      ? { kind: 'gateway', apiKey: input.AI_GATEWAY_API_KEY }
      : { kind: 'off' },
    webSearch: exaApiKey ? { kind: 'exa', apiKey: exaApiKey } : { kind: 'anthropic' },
    browser:
      browserbaseApiKey && browserbaseProjectId
        ? { kind: 'browserbase', apiKey: browserbaseApiKey, projectId: browserbaseProjectId }
        : { kind: 'sandbox' },
    billing: input.STRIPE_SECRET_KEY
      ? { kind: 'stripe', secretKey: input.STRIPE_SECRET_KEY }
      : { kind: 'off' },
    connectedApps:
      composioApiKey && proxyUrl && jwtSecret
        ? { kind: 'composio', apiKey: composioApiKey, proxyUrl, jwtSecret }
        : { kind: 'off' },
    storage: input.BLOB_READ_WRITE_TOKEN
      ? { kind: 'vercel-blob', token: input.BLOB_READ_WRITE_TOKEN }
      : { kind: 'off' },
  };
}
