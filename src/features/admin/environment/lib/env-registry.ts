import { EMAIL_ENV_KEYS } from './email-env-registry';
// Pure data, carries no values: safe on both sides of the RSC boundary.
// tests/environment/env-registry.test.mjs checks rows against the env schema; the
// no-raw-env-read lint rule limits raw process.env reads to keys listed beside it.
import { DEVELOPMENT_ENV_KEYS } from './env-registry-development';
import type { EnvKeyInfo } from './env-registry-types';

const POSTHOG_INGEST_HOST = 'https://eu.i.posthog.com';
// The single EU UI host shared by env and synchronization scripts.
export const POSTHOG_UI_HOST_DEFAULT = 'https://eu.posthog.com';

export const ENV_REGISTRY: readonly EnvKeyInfo[] = [
  {
    name: 'NEXT_PUBLIC_VERCEL_ENV',
    scope: 'client',
    required: false,
    outsideSchema: true,
    drives:
      'Provided by Vercel on every deploy (production, preview, development), never set by hand; tags browser events with their environment so dashboards show the environment chosen at the last sync. Elsewhere the build mode decides',
    group: 'Core',
  },
  // Core setup and optional sign-in providers.
  {
    name: 'DATABASE_URL',
    scope: 'server',
    required: true,
    drives: 'Points at the database every workspace, chat, and file record lives in',
    group: 'Core',
  },
  {
    name: 'DATABASE_URL_UNPOOLED',
    scope: 'server',
    required: false,
    outsideSchema: true,
    drives:
      'A direct, unpooled connection that pnpm db:migrate uses in preference to DATABASE_URL when running migrations',
    group: 'Core',
  },
  {
    name: 'DATABASE_WS_PROXY',
    scope: 'server',
    required: false,
    drives:
      'Local development only: the Neon WebSocket proxy from docker-compose.dev.yml, so the app and pnpm db:migrate use a plain local Postgres. It turns database TLS off, so production refuses it',
    group: 'Core',
  },
  {
    name: 'BETTER_AUTH_SECRET',
    scope: 'server',
    required: true,
    drives: 'Signs the session cookies that keep people signed in; changing it signs everyone out',
    group: 'Core',
  },
  {
    name: 'GOOGLE_CLIENT_ID',
    scope: 'server',
    required: false,
    drives: 'Identifies this app to Google so people can sign in with a Google account',
    group: 'Core',
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    scope: 'server',
    required: false,
    drives: 'Proves the app is really this app when Google hands a sign-in back',
    group: 'Core',
  },
  {
    name: 'AUTH_SIGNUPS_CLOSED',
    scope: 'server',
    required: false,
    defaultValue: 'false',
    drives:
      'Set to true to pause new sign-ups on every path (email code and Google); people who already have an account still sign in',
    group: 'Core',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    scope: 'client',
    required: true,
    drives: 'The public address of this deployment, used for sign-in redirects and links in email',
    group: 'Core',
  },
  {
    name: 'NEXT_PUBLIC_BRAND_NAME',
    scope: 'client',
    required: false,
    drives:
      'The product name people see, fixed at build time; unset shows a placeholder name, which a production build refuses',
    group: 'Core',
  },
  {
    name: 'SUPPORT_EMAIL',
    scope: 'server',
    required: false,
    drives:
      'Where people write for help: the Get help link, every email footer and the legal pages; the admin console can override it; unset shows a placeholder, which a production build refuses',
    group: 'Core',
  },

  // Anthropic — the agents themselves.
  {
    name: 'ANTHROPIC_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'Lets this app call Anthropic; without it seeding and the agent tester plan but never run',
    group: 'Anthropic',
  },
  {
    name: 'ANTHROPIC_AGENT_ID_FAST',
    scope: 'server',
    required: false,
    drives: 'Names the seeded Fast tier agent chats run on; every deployment gets its own',
    group: 'Anthropic',
  },
  {
    name: 'ANTHROPIC_AGENT_ID_DEFAULT',
    scope: 'server',
    required: false,
    drives: 'Names the seeded Default tier agent chats run on; every deployment gets its own',
    group: 'Anthropic',
  },
  {
    name: 'ANTHROPIC_AGENT_ID_PRO',
    scope: 'server',
    required: false,
    drives: 'Names the seeded Pro tier agent chats run on; every deployment gets its own',
    group: 'Anthropic',
  },
  {
    name: 'ANTHROPIC_ENVIRONMENT_ID',
    scope: 'server',
    required: false,
    drives: 'Names the seeded Environment the agents run inside, which decides what they can reach',
    group: 'Anthropic',
  },
  {
    name: 'ANTHROPIC_WEBHOOK_SECRET',
    scope: 'server',
    required: false,
    drives:
      'Delivers scheduled run results right away by verifying Anthropic webhooks; unset answers 503 and results wait for the recovery sweep',
    group: 'Anthropic',
  },

  // Composio — connected apps, reached through this deployment's proxy.
  {
    name: 'COMPOSIO_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'Turns on connected apps and needs both MCP proxy keys; unset leaves connected apps visible and explains how to turn them on',
    group: 'Composio',
  },
  {
    name: 'MCP_PROXY_URL',
    scope: 'server',
    required: false,
    drives:
      'The address of this deployment’s connected-apps proxy, which the agent is allowed to reach',
    group: 'Composio',
  },
  {
    name: 'MCP_PROXY_JWT_SECRET',
    scope: 'server',
    required: false,
    drives: 'Signs the per-person token the proxy checks; changing it revokes every issued token',
    group: 'Composio',
  },
  {
    name: 'COMPOSIO_WEBHOOK_SECRET',
    scope: 'server',
    required: false,
    drives: 'Checks that webhooks claiming to be from Composio really are; unset answers 503',
    group: 'Composio',
  },

  // Stripe — test mode only until the seed script accepts a live key.
  {
    name: 'STRIPE_SECRET_KEY',
    scope: 'server',
    required: false,
    drives: 'Turns on plans, credits and billing screens; unset runs with no credit or plan limits',
    group: 'Stripe',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    scope: 'server',
    required: false,
    drives:
      'Checks Stripe’s webhook signature; unset makes the app refuse the body rather than trust it',
    group: 'Stripe',
  },
  {
    name: 'BILLING_MODE',
    scope: 'server',
    required: false,
    drives:
      'How the app sells: subscriptions (monthly plans) or credits_only (one-time credits, no plans); unset means subscriptions, and the admin console can override it',
    group: 'Stripe',
  },

  // Files — the Drive-like surface and every upload.
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    scope: 'server',
    required: false,
    drives: 'Private file storage and scoped browser uploads',
    group: 'Files',
  },

  {
    name: 'AI_GATEWAY_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'Enables image, video and voice through Vercel AI Gateway; unset leaves the controls visible and explains how to turn them on',
    group: 'Media',
  },

  // Web tools — the abilities the agent runs on our own keys.
  {
    name: 'EXA_API_KEY',
    scope: 'server',
    required: false,
    drives: 'Selects Exa search and page reading; unset selects Anthropic web_search and web_fetch',
    group: 'Web tools',
  },
  {
    name: 'BROWSERBASE_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'Selects Browserbase with its project id; omit both keys for sandbox Playwright. A partial pair prevents startup',
    group: 'Web tools',
  },
  {
    name: 'BROWSERBASE_PROJECT_ID',
    scope: 'server',
    required: false,
    drives: 'The Browserbase project the agent’s browsing sessions are created in',
    group: 'Web tools',
  },

  ...EMAIL_ENV_KEYS,

  // PostHog — errors, logs, and product analytics on both sides.
  {
    name: 'POSTHOG_PROJECT_KEY',
    scope: 'server',
    required: false,
    drives: 'Sends server errors and logs to PostHog; unset falls back to the server console',
    group: 'PostHog',
  },
  {
    name: 'POSTHOG_HOST',
    scope: 'server',
    required: false,
    defaultValue: POSTHOG_INGEST_HOST,
    drives: 'Where server telemetry is sent; the EU region is the default, not the US one',
    group: 'PostHog',
  },
  {
    name: 'POSTHOG_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'A personal PostHog key with error_tracking:write (source maps upload on Vercel builds so stack traces read) plus dashboard, insight, alert write and user read (pnpm posthog:sync); a deploy build fails without the error-tracking scope once the key is set',
    group: 'PostHog',
  },
  {
    name: 'POSTHOG_PROJECT_ID',
    scope: 'server',
    required: false,
    drives: 'The numeric PostHog project those source maps are uploaded into',
    group: 'PostHog',
  },
  {
    name: 'POSTHOG_UPLOAD_SOURCEMAPS',
    scope: 'server',
    required: false,
    outsideSchema: true,
    drives:
      'Set to true on the deploy host to upload source maps at build time; unset, a build keeps the PostHog wrapper but uploads nothing',
    group: 'PostHog',
  },
  {
    name: 'NEXT_PUBLIC_POSTHOG_KEY',
    scope: 'client',
    required: false,
    drives:
      'Sends browser errors and analytics to PostHog; unset falls back to the browser console',
    group: 'PostHog',
  },
  {
    name: 'NEXT_PUBLIC_POSTHOG_HOST',
    scope: 'client',
    required: false,
    defaultValue: POSTHOG_INGEST_HOST,
    drives: 'Where browser telemetry is sent; the EU region is the default, not the US one',
    group: 'PostHog',
  },
  {
    name: 'NEXT_PUBLIC_POSTHOG_UI_HOST',
    scope: 'client',
    required: false,
    defaultValue: POSTHOG_UI_HOST_DEFAULT,
    drives: 'Where PostHog links and the toolbar open, which is the EU dashboard by default',
    group: 'PostHog',
  },

  // Cron — the scheduled cleanup and recovery jobs.
  {
    name: 'CRON_SECRET',
    scope: 'server',
    required: false,
    drives:
      'Required for scheduled cleanup and recovery: authorizes the billing, purge and recovery cron requests',
    group: 'Cron',
  },

  ...DEVELOPMENT_ENV_KEYS,
];
