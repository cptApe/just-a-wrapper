import { OverlayHost } from '@/app/_overlays/overlay-host';
import { AdminDataProviders } from '@/components/providers/app-providers';
import { ContactDetailsProvider } from '@/components/providers/contact-details-provider';
import { AdminShell } from '@/features/admin';
import type { ShellUser } from '@/features/shell';
import { MediaCapabilityProvider } from '@/features/voice/browser';
import { readContactDetails } from '@/lib/brand/contact';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';
import { capabilities } from '@/lib/runtime-capabilities';
import { version } from '../../../../package.json';

// The signed-in person is for the rail's account pill. Access is decided by
// `requireAdminAccess` in the route group layout; a loopback console may have no session.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [user, contact] = await withRequestContext({ route: 'admin-layout' }, () =>
    Promise.all([
      (async (): Promise<ShellUser | null> => {
        const session = await getRequestSession();
        if (!session) return null;
        return {
          name: session.user.name,
          email: session.user.email,
          image: session.user.image ?? null,
        };
      })(),
      readContactDetails(),
    ]),
  );
  return (
    <ContactDetailsProvider value={contact}>
      <AdminDataProviders>
        <MediaCapabilityProvider enabled={capabilities.media.kind === 'gateway'}>
          <AdminShell version={version} user={user}>
            {children}
            {/* The shared account menu offers Leave feedback, so its dialog opens here too. */}
            <OverlayHost only={['chart', 'feedback']} />
          </AdminShell>
        </MediaCapabilityProvider>
      </AdminDataProviders>
    </ContactDetailsProvider>
  );
}
