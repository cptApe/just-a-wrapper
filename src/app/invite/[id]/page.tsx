import { APIError } from 'better-auth/api';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { loginUrlWithReturnTo } from '@/features/auth/lib/return-to';
import { getInvitation } from '@/features/workspaces/api/get-invitation';
import { getWorkspaceName } from '@/features/workspaces/api/get-workspace-name';
import { AcceptInvitationCard } from '@/features/workspaces/components/accept-invitation-card';
import { InviteSwitchAccount } from '@/features/workspaces/components/invite-switch-account';
import { auth } from '@/lib/auth';
import { brand } from '@/lib/brand/identity';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';

export const metadata: Metadata = {
  title: `Join workspace · ${brand.name}`,
};

// Invitation pages sit outside the app shell because invitees may lack a workspace.
// Return signed-out users here after auth; validate recipient and expiry through Better Auth.
// Acceptance joins, activates and provisions the organization before /app renders.
// Wrong recipients can switch account; other invalid states share one coarse notice.

type InvitationView =
  | { kind: 'ok'; id: string; organizationName: string; inviterEmail: string }
  | { kind: 'wrong-account'; id: string; email: string }
  | { kind: 'invalid' };

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await withRequestContext(
    { route: 'invite-page' },
    async (): Promise<InvitationView> => {
      const h = await headers();
      const session = await getRequestSession();
      if (!session) redirect(loginUrlWithReturnTo(`/invite/${id}`));

      try {
        const invitation = await getInvitation(id, () =>
          auth.api.getInvitation({ query: { id }, headers: h }),
        );
        if ((await getWorkspaceName(invitation.organizationId)) === null)
          return { kind: 'invalid' };
        return {
          kind: 'ok',
          id,
          organizationName: invitation.organizationName,
          inviterEmail: invitation.inviterEmail,
        };
      } catch (error) {
        if (error instanceof APIError && error.statusCode === 403) {
          return { kind: 'wrong-account', id, email: session.user.email };
        }
        if (!isExpectedUserStateError(error)) {
          captureException(error, { route: 'invite-page', invitationId: id });
        }
        return { kind: 'invalid' };
      }
    },
  );

  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[440px] px-6 pt-8">
        <Logo />
      </header>
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center gap-8 px-6 py-12">
        <h1 className="text-title-page text-foreground">
          {view.kind === 'ok'
            ? `Join ${view.organizationName}`
            : view.kind === 'wrong-account'
              ? 'Switch accounts to join'
              : 'This invitation is no longer valid'}
        </h1>
        {view.kind === 'ok' ? (
          <AcceptInvitationCard invitationId={view.id} inviterEmail={view.inviterEmail} />
        ) : view.kind === 'wrong-account' ? (
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground" data-testid="invite-wrong-account">
              This invitation is for another email. You’re signed in as{' '}
              <span className="font-medium text-foreground">{view.email}</span>.
            </p>
            <div>
              <InviteSwitchAccount invitationId={view.id} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground" data-testid="invite-invalid">
              Ask your teammate to send a new invitation.
            </p>
            <Button asChild variant="secondary">
              <Link href="/app">Go to your workspace</Link>
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
