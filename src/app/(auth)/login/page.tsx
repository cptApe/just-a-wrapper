import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LOGO_MARK_PATH } from '@/components/brand/logo';
import { AuthForm } from '@/features/auth';
import { safeReturnTo } from '@/features/auth/lib/return-to';
import { brand } from '@/lib/brand/identity';
import { getRequestSession } from '@/lib/request-session';
import { capabilities } from '@/lib/runtime-capabilities';

export const metadata: Metadata = {
  title: `Sign in · ${brand.name}`,
};

// `returnTo` carries the post-auth destination captured by the auth gates;
// `next` is the name the mid-chat re-auth link (chat-view) sends and is read
// when `returnTo` is absent. AuthForm validates whichever with safeReturnTo, so
// a crafted value can never redirect off-origin.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; next?: string; error?: string }>;
}) {
  const { returnTo, next, error } = await searchParams;
  const session = await getRequestSession();
  if (session) redirect(safeReturnTo(returnTo ?? next) ?? '/app');

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <svg
        aria-hidden="true"
        className="-z-10 pointer-events-none absolute top-1/2 left-1/2 size-[min(160vw,1300px)] -translate-x-1/2 -translate-y-1/2 text-foreground opacity-[0.03] [mask-image:radial-gradient(circle_at_center,transparent_26%,black_52%)]"
        viewBox="0 0 64 64"
        fill="currentColor"
      >
        <path d={LOGO_MARK_PATH} />
      </svg>
      <AuthForm
        emailEnabled={capabilities.email.kind !== 'off'}
        returnTo={returnTo ?? next}
        googleEnabled={capabilities.googleSignIn.kind === 'google'}
        signupRefused={error === 'signup_disabled'}
      />
    </main>
  );
}
