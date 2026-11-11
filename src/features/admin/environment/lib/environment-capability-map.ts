export const CAPABILITY_GROUPS = [
  'The basics',
  'Payments',
  'Email',
  'Voice',
  'Images and video',
  'Connected apps',
  'Developer',
] as const;

export type CapabilityGroup = (typeof CAPABILITY_GROUPS)[number];

export type CapabilityInfo = {
  group: CapabilityGroup;
  /** One concrete sentence: what this value is and why the app wants it. */
  description: string;
  unset: string;
};

type TypedEnvKey = keyof typeof import('@/lib/env').env;
type RegistryOnlyEnvKey =
  | 'DATABASE_URL_UNPOOLED'
  | 'POSTHOG_UPLOAD_SOURCEMAPS'
  | 'NEXT_PUBLIC_VERCEL_ENV'
  | 'LOG_LEVEL'
  | 'NEXT_PUBLIC_E2E';
export type EnvKeyName = TypedEnvKey | RegistryOnlyEnvKey;

// The registry owns which keys exist; this map says what each one means.
export const ENV_CAPABILITIES = {
  DATABASE_URL: {
    group: 'The basics',
    description: 'Postgres connection string. Everything the app stores lives here.',
    unset: "Your app can't start",
  },
  DATABASE_URL_UNPOOLED: {
    group: 'The basics',
    description: 'Direct Postgres connection used for schema migrations.',
    unset: 'Database updates use the regular connection instead',
  },
  DATABASE_WS_PROXY: {
    group: 'Developer',
    description:
      'Address of the local proxy that lets the app use a plain Postgres instead of Neon. Local development only.',
    unset: 'The app connects to the database directly, as on Neon',
  },
  NEXT_PUBLIC_APP_URL: {
    group: 'The basics',
    description: 'The public address your app runs on. Links and sign-in callbacks use it.',
    unset: "Your app can't start",
  },
  NEXT_PUBLIC_BRAND_NAME: {
    group: 'The basics',
    description: 'The product name people see in the browser tab, emails and the sign-in page.',
    unset: 'The app is called by a placeholder name, and a production build refuses to start',
  },
  SUPPORT_EMAIL: {
    group: 'The basics',
    description: 'Where people write for help. The admin console can override it.',
    unset: 'A placeholder address shows, and a production build refuses to start',
  },
  BETTER_AUTH_SECRET: {
    group: 'The basics',
    description:
      'A long random string that signs session cookies. Generate one and keep it secret.',
    unset: "Your app can't start",
  },
  GOOGLE_CLIENT_ID: {
    group: 'The basics',
    description: 'OAuth client id from Google Cloud, for Google sign-in.',
    unset: "Your app can't start",
  },
  GOOGLE_CLIENT_SECRET: {
    group: 'The basics',
    description: 'OAuth client secret that pairs with the Google client id.',
    unset: "Your app can't start",
  },
  AUTH_SIGNUPS_CLOSED: {
    group: 'The basics',
    description: 'Set to true to pause new sign-ups. People with an account still sign in.',
    unset: 'Anyone can create an account',
  },
  ANTHROPIC_API_KEY: {
    group: 'The basics',
    description: 'Anthropic API key. Every agent in the app runs on it.',
    unset: 'Your app cannot create or test agents yet',
  },
  ANTHROPIC_ENVIRONMENT_ID: {
    group: 'The basics',
    description: "Anthropic environment your agents' sandboxes run in.",
    unset: 'Agent chats cannot start yet',
  },
  ANTHROPIC_AGENT_ID_FAST: {
    group: 'The basics',
    description: 'Anthropic agent id behind the Fast plan. pnpm seed:agents creates it.',
    unset: 'Fast chats cannot start yet',
  },
  ANTHROPIC_AGENT_ID_DEFAULT: {
    group: 'The basics',
    description: 'Anthropic agent id behind the Balanced plan. pnpm seed:agents creates it.',
    unset: 'Default chats cannot start yet',
  },
  ANTHROPIC_AGENT_ID_PRO: {
    group: 'The basics',
    description: 'Anthropic agent id behind the Expert plan. pnpm seed:agents creates it.',
    unset: 'Pro chats cannot start yet',
  },
  ANTHROPIC_WEBHOOK_SECRET: {
    group: 'The basics',
    description: 'Proves incoming agent webhooks really come from Anthropic.',
    unset: 'Scheduled run results wait for the next recovery check',
  },
  EXA_API_KEY: {
    group: 'The basics',
    description: 'Exa key agents use to search the web and read pages.',
    unset: 'Agents use Anthropic web search and page reading',
  },
  BROWSERBASE_API_KEY: {
    group: 'The basics',
    description: 'Browserbase key that gives agents a real browser.',
    unset: 'Agents use Playwright and Chromium in the sandbox',
  },
  BROWSERBASE_PROJECT_ID: {
    group: 'The basics',
    description: 'Browserbase project those browser sessions run in.',
    unset: 'Agents use Playwright and Chromium in the sandbox',
  },
  CRON_SECRET: {
    group: 'The basics',
    description: 'Protects the scheduled-cleanup endpoint so only your cron job can call it.',
    unset: 'Old data is not removed on schedule',
  },
  POSTHOG_PROJECT_KEY: {
    group: 'The basics',
    description: 'PostHog key server errors report to.',
    unset: 'Server errors are written to the server log instead',
  },
  POSTHOG_HOST: {
    group: 'The basics',
    description: 'PostHog server address the reports go to.',
    unset: 'The built-in EU address is used',
  },
  POSTHOG_API_KEY: {
    group: 'The basics',
    description: 'PostHog personal key that uploads readable stack traces with each build.',
    unset: 'Uploaded error reports may be harder to read',
  },
  POSTHOG_PROJECT_ID: {
    group: 'The basics',
    description: 'PostHog project those readable stack traces upload to.',
    unset: 'Readable error details cannot be uploaded',
  },
  NEXT_PUBLIC_POSTHOG_KEY: {
    group: 'The basics',
    description: 'PostHog key browser errors report to.',
    unset: 'Browser errors stay in the browser console',
  },
  NEXT_PUBLIC_POSTHOG_HOST: {
    group: 'The basics',
    description: 'PostHog address the browser reports to.',
    unset: 'The built-in EU address is used',
  },
  NEXT_PUBLIC_POSTHOG_UI_HOST: {
    group: 'The basics',
    description: 'PostHog dashboard address that error links point at.',
    unset: 'The built-in EU dashboard is used',
  },
  POSTHOG_UPLOAD_SOURCEMAPS: {
    group: 'The basics',
    description: 'Set to true on the deploy host so builds upload source maps to PostHog.',
    unset: 'Builds upload nothing, which is right for a local build',
  },
  NEXT_PUBLIC_VERCEL_ENV: {
    group: 'The basics',
    description:
      'Provided by Vercel; tags browser events with production, preview, or development.',
    unset: 'The build mode decides: a production build counts as production',
  },
  STRIPE_SECRET_KEY: {
    group: 'Payments',
    description: 'Stripe secret key for subscriptions and charges.',
    unset: 'Your app cannot charge customers yet',
  },
  STRIPE_WEBHOOK_SECRET: {
    group: 'Payments',
    description: 'Proves incoming payment webhooks really come from Stripe.',
    unset: 'Your app cannot safely accept payment updates yet',
  },
  BILLING_MODE: {
    group: 'Payments',
    description: 'Whether you sell monthly plans or one-time credits only.',
    unset: 'You sell monthly plans, unless the admin console says otherwise',
  },
  RESEND_API_KEY: {
    group: 'Email',
    description: 'Resend key that sends requested and urgent emails.',
    unset: 'Development prints emails; other deployments disable email',
  },
  EMAIL_FROM: {
    group: 'Email',
    description: 'The From address on Resend emails.',
    unset: 'Emails come from hello@ on the brand domain, which must be verified in Resend',
  },
  BLOB_READ_WRITE_TOKEN: {
    group: 'Images and video',
    description: 'Stores files in private Vercel Blob storage.',
    unset: 'People cannot upload or read files yet',
  },
  AI_GATEWAY_API_KEY: {
    group: 'Images and video',
    description: 'Gateway key for image, video and voice.',
    unset: 'Media tools, microphone and read-aloud are hidden',
  },
  COMPOSIO_API_KEY: {
    group: 'Connected apps',
    description: 'Composio key that powers connected apps like Gmail and Notion.',
    unset: 'Agents cannot use connected apps yet',
  },
  COMPOSIO_WEBHOOK_SECRET: {
    group: 'Connected apps',
    description: 'Proves incoming connected-app webhooks really come from Composio.',
    unset: 'Your app cannot safely accept connected app updates yet',
  },
  MCP_PROXY_URL: {
    group: 'Connected apps',
    description: 'Address of the proxy agents reach connected apps through.',
    unset: 'Agents cannot reach connected apps yet',
  },
  MCP_PROXY_JWT_SECRET: {
    group: 'Connected apps',
    description: 'Signs proxy requests so app connections stay private.',
    unset: 'Your app cannot safely open app connections yet',
  },
  NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: {
    group: 'Developer',
    description: 'Turns these admin pages on.',
    unset: 'These admin pages stay hidden',
  },
  NEXT_PUBLIC_ENABLE_DEV_ROUTES: {
    group: 'Developer',
    description: 'Turns developer-only pages and helpers on.',
    unset: 'Developer-only pages stay off',
  },
  DEV_AUTH_ALLOW_LOCAL_PROD: {
    group: 'Developer',
    description: 'Lets the dev sign-in shortcut work on local production builds.',
    unset: 'The dev sign-in shortcut only works while running next dev',
  },
  LOG_LEVEL: {
    group: 'Developer',
    description: 'How much detail server logs carry, from debug to error.',
    unset: 'The normal amount of detail is used',
  },
  NEXT_PUBLIC_E2E: {
    group: 'Developer',
    description: 'Compiles browser-test helpers into the build.',
    unset: 'Browser test helpers are left out of builds',
  },
} satisfies Record<EnvKeyName, CapabilityInfo>;

// Within each group, the order you would fill things in.
export const GROUP_ORDER: Record<CapabilityGroup, readonly EnvKeyName[]> = {
  'The basics': [
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_BRAND_NAME',
    'SUPPORT_EMAIL',
    'DATABASE_URL',
    'DATABASE_URL_UNPOOLED',
    'BETTER_AUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'AUTH_SIGNUPS_CLOSED',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_ENVIRONMENT_ID',
    'ANTHROPIC_AGENT_ID_FAST',
    'ANTHROPIC_AGENT_ID_DEFAULT',
    'ANTHROPIC_AGENT_ID_PRO',
    'ANTHROPIC_WEBHOOK_SECRET',
    'EXA_API_KEY',
    'BROWSERBASE_API_KEY',
    'BROWSERBASE_PROJECT_ID',
    'CRON_SECRET',
    'POSTHOG_PROJECT_KEY',
    'POSTHOG_HOST',
    'POSTHOG_API_KEY',
    'POSTHOG_PROJECT_ID',
    'NEXT_PUBLIC_POSTHOG_KEY',
    'NEXT_PUBLIC_POSTHOG_HOST',
    'NEXT_PUBLIC_POSTHOG_UI_HOST',
    'POSTHOG_UPLOAD_SOURCEMAPS',
    'NEXT_PUBLIC_VERCEL_ENV',
  ],
  Payments: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_MODE'],
  Email: ['RESEND_API_KEY', 'EMAIL_FROM'],
  Voice: [],
  'Images and video': ['AI_GATEWAY_API_KEY', 'BLOB_READ_WRITE_TOKEN'],
  'Connected apps': [
    'COMPOSIO_API_KEY',
    'COMPOSIO_WEBHOOK_SECRET',
    'MCP_PROXY_URL',
    'MCP_PROXY_JWT_SECRET',
  ],
  Developer: [
    'NEXT_PUBLIC_ENABLE_ADMIN_ROUTES',
    'NEXT_PUBLIC_ENABLE_DEV_ROUTES',
    'DEV_AUTH_ALLOW_LOCAL_PROD',
    'DATABASE_WS_PROXY',
    'LOG_LEVEL',
    'NEXT_PUBLIC_E2E',
  ],
};
