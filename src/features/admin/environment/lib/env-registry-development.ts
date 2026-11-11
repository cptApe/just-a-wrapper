import type { EnvKeyInfo } from './env-registry-types';
export const DEVELOPMENT_ENV_KEYS: readonly EnvKeyInfo[] = [
  // Dev — the dev endpoints and the admin console, both off unless you say otherwise, plus the
  // two knobs read straight from process.env rather than through the schema.
  {
    name: 'NEXT_PUBLIC_ENABLE_DEV_ROUTES',
    scope: 'client',
    required: false,
    defaultValue: 'false',
    drives: 'Enables the dev login and preset backfill endpoints',
    group: 'Dev',
  },
  {
    name: 'NEXT_PUBLIC_ENABLE_ADMIN_ROUTES',
    scope: 'client',
    required: false,
    defaultValue: 'false',
    drives: 'Set to true to expose this operator console; it stays hidden otherwise',
    group: 'Dev',
  },
  {
    name: 'DEV_AUTH_ALLOW_LOCAL_PROD',
    scope: 'server',
    required: false,
    defaultValue: 'false',
    drives:
      'Lets the dev sign-in shortcut work on local next-start builds; never set it in a deployed environment',
    group: 'Dev',
  },
  {
    name: 'LOG_LEVEL',
    scope: 'server',
    required: false,
    defaultValue: 'info',
    drives: 'How much the server writes to its log; set it to debug when you are chasing something',
    group: 'Dev',
  },

  {
    name: 'NEXT_PUBLIC_E2E',
    scope: 'client',
    required: false,
    outsideSchema: true,
    drives:
      'Set to 1 at build time to keep the browser test hooks in a production build; normal builds drop them',
    group: 'Dev',
  },
];
