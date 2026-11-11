import type { EnvKeyInfo } from './env-registry-types';
export const EMAIL_ENV_KEYS: EnvKeyInfo[] = [
  {
    name: 'RESEND_API_KEY',
    scope: 'server',
    required: false,
    drives:
      'Sends requested and urgent emails from EMAIL_FROM; development logs emails without a key; other deployments disable email without a key',
    group: 'Email',
  },
  {
    name: 'EMAIL_FROM',
    scope: 'server',
    required: false,
    drives:
      'The From address on Resend emails; unset uses "<brand name> <hello@<brand domain>>", which needs the domain verified in Resend',
    group: 'Email',
  },
];
