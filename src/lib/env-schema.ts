import { z } from 'zod';

// Required setup keys live here so the runtime environment and the setup
// validator enforce the same rules. Optional service keys stay in env.ts.
export const requiredServerEnvShape = {
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
} as const;

export const requiredClientEnvShape = {
  NEXT_PUBLIC_APP_URL: z.string().url(),
} as const;

export const requiredConfigEnvSchema = z.object({
  ...requiredServerEnvShape,
  ...requiredClientEnvShape,
});

type DeploymentEnvironment = {
  NEXT_PUBLIC_APP_URL?: string | undefined;
  NODE_ENV?: string | undefined;
  VERCEL_ENV?: string | undefined;
};

function isLoopbackApp(environment: DeploymentEnvironment): boolean {
  const url = environment.NEXT_PUBLIC_APP_URL;
  const hostname = url && URL.canParse(url) ? new URL(url).hostname : null;
  return hostname !== null && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

export function isProductionDeployment(environment: DeploymentEnvironment): boolean {
  return (
    environment.VERCEL_ENV === 'production' ||
    (environment.NODE_ENV === 'production' &&
      environment.VERCEL_ENV !== 'preview' &&
      !isLoopbackApp(environment))
  );
}

/**
 * Who may open the admin console. Off unless the flag is on, and never in
 * production. Only a loopback app outside Vercel stays open, because a fresh
 * local checkout may not have sign-in working yet. Every other host, Vercel
 * previews included, requires a signed-in user.
 */
export function adminConsoleAccess(
  environment: DeploymentEnvironment & { NEXT_PUBLIC_ENABLE_ADMIN_ROUTES?: string | undefined },
): 'disabled' | 'open' | 'signed_in' {
  if (environment.NEXT_PUBLIC_ENABLE_ADMIN_ROUTES !== 'true') return 'disabled';
  if (isProductionDeployment(environment)) return 'disabled';
  if (environment.VERCEL_ENV === undefined && isLoopbackApp(environment)) return 'open';
  return 'signed_in';
}

/**
 * Where a local Neon WebSocket proxy listens, as host:port/path. The driver
 * adds the ws:// scheme itself, so a scheme here is a mistake.
 */
export const databaseWsProxyValue = z
  .string()
  .regex(
    /^[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/,
    'DATABASE_WS_PROXY is host:port/path, for example localhost:54446/v1, without ws://.',
  );

const databaseProxySchema = z
  .object({
    DATABASE_WS_PROXY: databaseWsProxyValue.optional(),
    NEXT_PUBLIC_APP_URL: z.string().optional(),
    NODE_ENV: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
  })
  .superRefine((environment, context) => {
    // The local proxy speaks plain WebSocket, so the database link has no TLS.
    if (environment.DATABASE_WS_PROXY && isProductionDeployment(environment)) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_WS_PROXY'],
        message: 'DATABASE_WS_PROXY turns off database TLS and must be unset in production.',
      });
    }
  });

/**
 * The local database proxy to route the Neon driver through, or null for a
 * normal Neon connection. Throws when the value is malformed or the
 * deployment is production. An empty value counts as unset.
 */
export function localDatabaseProxy(
  environment: DeploymentEnvironment & { DATABASE_WS_PROXY?: string | undefined },
): string | null {
  const proxy = environment.DATABASE_WS_PROXY?.trim() || undefined;
  return (
    databaseProxySchema.parse({ ...environment, DATABASE_WS_PROXY: proxy }).DATABASE_WS_PROXY ??
    null
  );
}

export const adminDeploymentSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NODE_ENV: z.string().optional(),
    VERCEL_ENV: z.string().optional(),
    NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: z.enum(['true', 'false']).optional(),
    NEXT_PUBLIC_ENABLE_DEV_ROUTES: z.enum(['true', 'false']).optional(),
  })
  .superRefine((environment, context) => {
    // Admin and dev routes share one rule: never in production, allowed on
    // loopback production builds and explicit Vercel previews.
    const gatedRoutes = [
      ['NEXT_PUBLIC_ENABLE_ADMIN_ROUTES', 'The admin console must be disabled in production.'],
      ['NEXT_PUBLIC_ENABLE_DEV_ROUTES', 'Development routes must be disabled in production.'],
    ] as const;
    for (const [name, message] of gatedRoutes) {
      if (environment[name] === 'true' && isProductionDeployment(environment)) {
        context.addIssue({ code: 'custom', path: [name], message });
      }
    }
  });
