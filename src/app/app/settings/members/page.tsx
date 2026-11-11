import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';
import { InfoHint } from '@/components/ui/info-hint';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { getDisplayPreferences } from '@/features/preferences/api/get-preferences';
import {
  getMemberDirectoryUsage,
  listPendingInvitations,
  listWorkspaceMembers,
} from '@/features/workspaces/api/members';
import { InviteMembers } from '@/features/workspaces/components/invite-members-modal';
import { type MemberListItem, MembersTable } from '@/features/workspaces/components/members-table';
import { PendingInvitations } from '@/features/workspaces/components/pending-invitations';
import { primaryRole } from '@/features/workspaces/lib/roles';
import { brand } from '@/lib/brand/identity';
import { type Caller, findCaller } from '@/lib/caller';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { AppError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format/format-relative';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import { roleIsAtLeast } from '@/lib/workspace-role';
import { MembersPageSkeleton } from './members-page-skeleton';

export const metadata: Metadata = {
  title: `Members · ${brand.name}`,
};

// Members shows the searchable member and invitation lists.
// Owner/admin controls manage roles, removals and invitations; Better Auth
// enforces the same permissions server-side.
export default function MembersSettingsPage() {
  return (
    // Use the standard settings column. Keep the page within its data boundary
    // because the header action also requires the caller role.
    <div className="w-full md:pt-8">
      <Boundary loading={<MembersPageSkeleton />} error={<MembersError />}>
        <MembersLoader />
      </Boundary>
    </div>
  );
}

// Stamped at read time on the server, in the reader's zone, so the client table renders a string.
function lastActiveLabel(lastActiveAt: Date | null, timeZone: string): string {
  return lastActiveAt ? formatRelativeTime(lastActiveAt, { now: Date.now(), timeZone }) : 'Not yet';
}

async function MembersLoader() {
  const data = await withRequestContext({ route: 'settings-members-page' }, async () => {
    let membership: Caller | null;
    const h = await headers();
    try {
      membership = await findCaller(h);
    } catch (error) {
      // Signed out → the login page, like every other settings surface; anything
      // else is a real failure and belongs to the error boundary.
      if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
        redirect(await loginRedirectUrl());
      throw error;
    }
    if (!membership) redirect('/app');

    const [members, invitations, usageByUser, { timeZone }] = await Promise.all([
      listWorkspaceMembers(membership.organizationId),
      listPendingInvitations(membership.organizationId),
      getMemberDirectoryUsage(membership.organizationId),
      getDisplayPreferences(h),
    ]);

    // Stamp the last-active label and fold in per-member usage here (server) so
    // the interactive table stays pure — no Date math, no hydration drift.
    const rows: MemberListItem[] = members.map((m) => ({
      memberId: m.memberId,
      userId: m.userId,
      name: m.name,
      email: m.email,
      image: m.image,
      role: primaryRole(m.role),
      isViewer: m.userId === membership.userId,
      lastActiveLabel: lastActiveLabel(m.lastActiveAt, timeZone),
      creditsUsed: usageByUser === null ? null : (usageByUser[m.userId] ?? 0),
    }));

    return {
      rows,
      invitations,
      isAdmin: roleIsAtLeast(membership.role, 'admin'),
      viewerRole: primaryRole(membership.role),
    };
  });

  const emailEnabled = capabilities.email.kind !== 'off';
  return (
    <>
      <SettingsPageHeader
        title="Members"
        action={
          <InviteMembers
            canInvite={data.isAdmin}
            viewerRole={data.viewerRole}
            emailEnabled={emailEnabled}
          />
        }
      />
      <div className="pt-8">
        <MembersTable members={data.rows} isAdmin={data.isAdmin} viewerRole={data.viewerRole} />

        <SettingsSection
          title="Pending invitations"
          divided={false}
          hint={
            <InfoHint>
              Invitations stay here until they’re accepted.
              {emailEnabled
                ? ' Expired ones can be resent.'
                : ` ${CAPABILITY_OFF_MESSAGES.email} Until then, copy each invite link.`}
            </InfoHint>
          }
        >
          <PendingInvitations
            invitations={data.invitations}
            canManage={data.isAdmin}
            emailEnabled={emailEnabled}
          />
        </SettingsSection>
      </div>
    </>
  );
}

function MembersError() {
  return (
    <ErrorState
      title="Couldn’t load members"
      message="Something went wrong reading the workspace members. Reload the page to try again."
    />
  );
}
