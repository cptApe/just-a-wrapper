import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';
import { assertBrandConfigured } from './brand/requirements';
import { BILLING_MODES } from './deployment-settings/registry';
import {
  adminDeploymentSchema,
  databaseWsProxyValue,
  localDatabaseProxy,
  requiredClientEnvShape,
  requiredServerEnvShape,
} from './env-schema';

// Refuse unsafe production settings server-side before anything renders. Preview deployments remain opt-in.
if (typeof window === 'undefined') {
  adminDeploymentSchema.parse(process.env);
  localDatabaseProxy(process.env);
  assertBrandConfigured(process.env);
}

// The full key shapes. createEnv validates them below; the registry test reads keys, requiredness
// and defaults from them.
export const serverEnvShape = {
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ...requiredServerEnvShape,
  // Local development only: a Neon WebSocket proxy in front of plain Postgres
  // (docker-compose.dev.yml). It turns database TLS off, so production refuses it.
  DATABASE_WS_PROXY: z.optional(databaseWsProxyValue.or(z.literal(''))),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Anthropic key is optional for build and seed-plan validation.
  // Only configured seeds perform live provider calls.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Agent/Environment IDs printed by `scripts/seed-agents.ts` (live run) and
  // pasted into .env per environment (preview and production each get their
  // own).
  ANTHROPIC_AGENT_ID_FAST: z.string().min(1).optional(),
  ANTHROPIC_AGENT_ID_DEFAULT: z.string().min(1).optional(),
  ANTHROPIC_AGENT_ID_PRO: z.string().min(1).optional(),
  ANTHROPIC_ENVIRONMENT_ID: z.string().min(1).optional(),
  // Per-environment proxy URL baked into the environment egress allow-list.
  MCP_PROXY_URL: z.string().url().optional(),
  // Composio project API key. Server-side only — never exposed to
  // the agent/caller. The MCP proxy mints Tool Router sessions with it and
  // injects it as `x-api-key` on the upstream forward. Optional: without it
  // the proxy returns a typed 503 notice instead of throwing at module
  // load, so the build passes before the key exists.
  COMPOSIO_API_KEY: z.string().min(1).optional(),
  // HS256 secret for inbound Bearer JWTs carrying { member_id, exp }.
  // Tokens are signed at vault creation; rotate this key to revoke them.
  // An unset key produces a typed 503 response, not a build failure.
  MCP_PROXY_JWT_SECRET: z.string().min(32).optional(),
  // Stripe keys are optional at build time; missing keys produce typed service notices.
  // Seed scripts require test keys. Webhook handling requires a signing secret
  // and treats an empty environment value as unset, never as permission to skip verification.
  STRIPE_SECRET_KEY: z.string().min(1).optional().or(z.literal('')),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional().or(z.literal('')),
  // How a deployment with Stripe sells: 'subscriptions' (monthly plans, the default) or
  // 'credits_only' (one-time credits, no plans). An admin can override it in the admin console.
  BILLING_MODE: z.enum(BILLING_MODES).optional(),
  // Where people write for help: the Get help link, every email footer and the legal pages. The
  // admin console can override it. Required in production; elsewhere a placeholder stands in.
  SUPPORT_EMAIL: z.string().trim().pipe(z.email()).optional(),
  // PostHog (errors + OTLP log ingest). The ingest *project* token
  // (phc_…), used by posthog-node for error capture AND as the OTLP logs
  // Bearer. Optional: without it captureException falls back to console and
  // the OTLP LoggerProvider is not registered, so the build passes keyless.
  POSTHOG_PROJECT_KEY: z.string().min(1).optional(),
  // PostHog ingest host. EU Cloud region, not the US default.
  POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),
  // Source-map upload (build-time, `@posthog/nextjs-config`). Distinct from
  // the ingest token: a *personal* API key with error-tracking write +
  // numeric project id. Optional — source-map upload no-ops when unset.
  POSTHOG_API_KEY: z.string().min(1).optional(),
  POSTHOG_PROJECT_ID: z.string().min(1).optional(),
  // Media and voice are enabled together by this server credential.
  AI_GATEWAY_API_KEY: z.string().min(1).optional(),
  // Optional web providers are selected once at startup.
  EXA_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_API_KEY: z.string().min(1).optional(),
  BROWSERBASE_PROJECT_ID: z.string().min(1).optional(),
  // Anthropic webhook signing secret (Standard Webhooks, `whsec_…`). Optional:
  // /api/webhooks/anthropic returns a typed 503 notice when unset rather than
  // failing the build.
  ANTHROPIC_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Composio webhook signing secret for Standard Webhooks HMAC.
  // Find it under Project Settings → Webhook. An unset secret makes the webhook
  // route return a typed 503 without failing the build.
  COMPOSIO_WEBHOOK_SECRET: z.string().min(1).optional(),
  // Optional at build time; storage operations fail explicitly when the private store is unconfigured.
  BLOB_READ_WRITE_TOKEN: z
    .string()
    .regex(
      /^vercel_blob_rw_[a-z0-9]+_[a-z0-9]+$/i,
      'BLOB_READ_WRITE_TOKEN must contain a valid Blob store ID and secret.',
    )
    .optional(),
  // Without a key, development prints emails; other deployments disable email.
  RESEND_API_KEY: z.string().min(1).optional(),
  // The From header for Resend sends. Defaults to `<brand name> <hello@<brand
  // domain>>`; the domain must be verified in Resend.
  EMAIL_FROM: z.string().min(3).optional(),
  // Cron routes require Bearer CRON_SECRET and fail closed with 401 when unset.
  // The key is optional at build time.
  CRON_SECRET: z.string().min(1).optional(),
  // Lets the dev sign-in shortcut work on LOCAL `next start` builds (the
  // NODE_ENV gate alone would kill the shortcut there). Server-only and never
  // set in a deployed environment — a deploy that set it would still need
  // NEXT_PUBLIC_ENABLE_DEV_ROUTES=true AND a localhost Host to reach
  // the route. Default 'false' keeps NODE_ENV as the sole non-dev gate.
  DEV_AUTH_ALLOW_LOCAL_PROD: z.enum(['true', 'false']).default('false'),
  // 'true' closes new sign-ups on every path (email code and Google) while
  // existing accounts keep signing in. Unknown emails get no code and no
  // hint that the address is unknown; unknown Google accounts come back to
  // the login page with a notice. Invitations to people without an account
  // cannot be accepted while this is on.
  AUTH_SIGNUPS_CLOSED: z.enum(['true', 'false']).default('false'),
};
export const clientEnvShape = {
  ...requiredClientEnvShape,
  // The product name people see, inlined at build time. Required in production; elsewhere a
  // placeholder from content/brand.ts stands in. Read through src/lib/brand/identity.ts.
  NEXT_PUBLIC_BRAND_NAME: z.string().trim().min(1).optional(),
  // Gates the dev-only infrastructure endpoints: dev login (+ the captured
  // OTP readout), the preset-backfill provisioning endpoint, and the team
  // digest preview. Off by default so a production deploy exposes none of them.
  NEXT_PUBLIC_ENABLE_DEV_ROUTES: z.enum(['true', 'false']).default('false'),
  // The /admin console (viewer, prompt generator and the deployment settings in
  // src/lib/deployment-settings). Off by default so a production deploy does not expose it.
  // NEXT_PUBLIC_* values are inlined at build time and the pages prerender
  // static, so switching this on takes a rebuild, not just a restart.
  NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: z.enum(['true', 'false']).default('false'),
  // posthog-js project token (client error capture + analytics).
  // Optional: the client capture sink falls back to console when unset.
  NEXT_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
  // Client ingest + UI hosts. EU Cloud region. `*_HOST` is the ingest
  // endpoint; `*_UI_HOST` is where toolbar/links resolve (eu.posthog.com).
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),
  NEXT_PUBLIC_POSTHOG_UI_HOST: z.string().url().default('https://eu.posthog.com'),
};

export const env = createEnv({
  server: serverEnvShape,
  client: clientEnvShape,
  // Next >= 13.4.4: only NEXT_PUBLIC_* keys are listed; server keys read from process.env.
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
    NEXT_PUBLIC_ENABLE_DEV_ROUTES: process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES,
    NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: process.env.NEXT_PUBLIC_ENABLE_ADMIN_ROUTES,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
  },
});

export const nodeEnv = process.env.NODE_ENV;

// Presence is distinct from validated defaults. The admin page receives only this boolean.
const BUILT_CLIENT_ENV: Partial<Record<string, string | undefined>> = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
  NEXT_PUBLIC_ENABLE_DEV_ROUTES: process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES,
  NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: process.env.NEXT_PUBLIC_ENABLE_ADMIN_ROUTES,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
  NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
};
export function isEnvironmentKeySet(name: string): boolean {
  const raw = name.startsWith('NEXT_PUBLIC_') ? BUILT_CLIENT_ENV[name] : process.env[name];
  return typeof raw === 'string' && raw.trim().length > 0;
}

// Return rejected key names only; validation errors can contain secret values.
export function rejectedEnvironmentKeys(shape: z.ZodRawShape): string[] {
  const parsed = z.object(shape).safeParse(process.env);
  if (parsed.success) return [];
  return [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
}
