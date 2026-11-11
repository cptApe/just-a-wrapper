/** Service grouping a key belongs to. */
type EnvGroup =
  | 'Core'
  | 'Anthropic'
  | 'Composio'
  | 'Stripe'
  | 'Files'
  | 'Realtime'
  | 'Media'
  | 'Web tools'
  | 'Notifications'
  | 'Email'
  | 'PostHog'
  | 'Cron'
  | 'Dev';

export type EnvKeyInfo = {
  name: string;
  /** `client` keys are the NEXT_PUBLIC_* ones: readable in the browser, baked in at build. */
  scope: 'server' | 'client';
  /** Declared in `env-schema.ts`, so the app refuses to start without it. */
  required: boolean;
  /** The value used when the key is unset. Committed config, never a secret. */
  defaultValue?: string;
  /**
   * Read straight from `process.env` instead of through the validated `env`
   * object — a handful of runtime reads and the setup scripts. The drift
   * test skips these when matching the registry against the schema files,
   * because there is no schema line to match.
   */
  outsideSchema?: true;
  /** One plain sentence: what this key turns on, and what happens without it. */
  drives: string;
  group: EnvGroup;
};
