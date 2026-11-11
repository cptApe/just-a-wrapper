// The app-side boundaries an integration test may replace (docs/decisions/0012): configuration,
// operator pricing and the signed-in browser session. Every test that replaces one does it through these helpers, so a
// seam is faked the same way everywhere and a change to its shape is made once.
//
// vi.mock factories run before the file's imports, so load this module inside the factory:
//   vi.mock('@/lib/env', async (actual) =>
//     (await import('./helpers/seams')).envWith(actual, { CRON_SECRET: 'test' }),
//   );
//   vi.mock('@/lib/auth', async () => (await import('./helpers/seams')).signedInAs(() => viewer));

import type * as PricingModule from '@/features/billing/pricing-config';
import type * as EnvModule from '@/lib/env';

type Env = typeof EnvModule.env;

/** The real env module with some keys replaced; an `undefined` value unsets the key. */
export async function envWith(
  importOriginal: <T>() => Promise<T>,
  overrides: { [K in keyof Env]?: Env[K] | undefined },
  module: Partial<Omit<typeof EnvModule, 'env'>> = {},
) {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, ...module, env: { ...actual.env, ...overrides } };
}

/** Who the request is signed in as; null is a signed-out request. */
export type Viewer = {
  userId: string;
  organizationId: string | null;
  email?: string;
  name?: string;
  timezone?: string | null;
  /** The auth_session row id, for code that updates the session row itself. */
  sessionId?: string;
} | null;

/** better-auth's session lookup, answering with whoever `current()` names at call time. */
export function signedInAs(current: () => Viewer | Promise<Viewer>) {
  return {
    auth: {
      api: {
        getSession: async () => {
          const viewer = await current();
          if (!viewer) return null;
          return {
            user: {
              id: viewer.userId,
              email: viewer.email ?? `${viewer.userId}@example.test`,
              name: viewer.name ?? 'Test',
              timezone: viewer.timezone ?? 'UTC',
              image: null,
            },
            session: {
              id: viewer.sessionId ?? `${viewer.userId}-session`,
              userId: viewer.userId,
              activeOrganizationId: viewer.organizationId,
            },
          };
        },
      },
    },
  };
}

/** The real pricing configuration with some values replaced, as a fork that edits it would ship. */
export async function pricingWith(
  importOriginal: <T>() => Promise<T>,
  overrides: Partial<typeof PricingModule>,
) {
  return { ...(await importOriginal<typeof PricingModule>()), ...overrides };
}
