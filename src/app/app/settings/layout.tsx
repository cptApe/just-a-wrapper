import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { SettingsShell } from '@/features/settings';
import { findCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';
import { roleIsAtLeast } from '@/lib/workspace-role';

// /app/settings/* lives OUTSIDE the (shell) route group on purpose:
// settings swaps the app sidebar for its own settings sidebar, so it must not
// render inside <AppShell>. Keeping it out of the group also skips the shell's
// sidebar data work (task history, billing summary, workspace list) that
// settings never shows. The auth gate stays equivalent: no session → clean
// server redirect to /login before anything streams. Deeper provisioning
// healing remains the (app) layout's job — a user can always reach their
// settings even mid-repair.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const shell = await withRequestContext({ route: 'settings-layout' }, async () => {
    const h = await headers();
    const session = await getRequestSession();
    if (!session) redirect(await loginRedirectUrl());
    // The rail hides Billing from non-admins; the server enforces the real gate.
    const membership = await findCaller(h);
    return {
      isAdmin: membership ? roleIsAtLeast(membership.role, 'admin') : false,
      // Same shape the (shell) layout hands the sidebar footer — the account
      // pill is the same component in both shells.
      user: {
        name: session.user.name,
        email: session.user.email,
        image: session.user.image ?? null,
      },
    };
  });

  return (
    <SettingsShell isAdmin={shell.isAdmin} user={shell.user}>
      {children}
    </SettingsShell>
  );
}
