import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { env } from '@/lib/env';
import { adminConsoleAccess } from '@/lib/env-schema';
import { AuthorizationError } from '@/lib/errors';
import { getRequestSession } from '@/lib/request-session';

function consoleAccess() {
  return adminConsoleAccess({
    NEXT_PUBLIC_ENABLE_ADMIN_ROUTES: env.NEXT_PUBLIC_ENABLE_ADMIN_ROUTES,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
}

/** The one admin gate: every `(admin)` layout and route handler calls it first. */
export async function requireAdminAccess(): Promise<void> {
  const access = consoleAccess();
  if (access === 'disabled') notFound();
  if (access === 'signed_in' && !(await getRequestSession())) redirect(await loginRedirectUrl());
}

/**
 * The same gate for an admin server action, which is a public endpoint of its own: it throws
 * instead of redirecting, and names who acts. The open local console has nobody signed in.
 */
export async function requireAdminActor(): Promise<{ userId: string | null }> {
  const access = consoleAccess();
  if (access === 'disabled') throw new AuthorizationError('The admin console is off.');
  const session = await getRequestSession();
  if (access === 'signed_in' && !session) throw new AuthorizationError('Sign in to change this.');
  return { userId: session?.user.id ?? null };
}
