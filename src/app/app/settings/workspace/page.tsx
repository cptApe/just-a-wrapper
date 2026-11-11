import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Boundary } from '@/components/layouts/boundary';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsSection } from '@/components/settings/settings-section';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { getBillingSummary } from '@/features/billing';
import { uploadConfig } from '@/features/files/server';
import { getDisplayPreferences } from '@/features/preferences/api/get-preferences';
import { getWorkspaceSettings } from '@/features/workspaces/api/get-workspace-settings';
import { WorkspaceDangerZone } from '@/features/workspaces/components/workspace-danger-zone';
import { WorkspaceIdentity } from '@/features/workspaces/components/workspace-identity';
import { WorkspaceNameRow } from '@/features/workspaces/components/workspace-name-form';
import {
  type PlanAction,
  WorkspacePlanRow,
} from '@/features/workspaces/components/workspace-plan-row';
import { brand } from '@/lib/brand/identity';
import { type Caller, findCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { formatDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import { WorkspacePageSkeleton } from './workspace-page-skeleton';

export const metadata: Metadata = {
  title: `Workspace · ${brand.name}`,
};

// Workspace settings loads identity, plan, name editing and danger actions.
// Resolve role and workspace facts here; Members owns member management.
export default function WorkspaceSettingsPage() {
  return (
    // Frame = account/general exactly: the shell centers the reading column at the
    // same width + padding; md:pt-8 lifts the identity hero onto library's ~80px
    // datum so this page reads as their sibling.
    <div className="w-full md:pt-8">
      <Boundary loading={<WorkspacePageSkeleton />} error={<WorkspaceError />}>
        <WorkspaceLoader />
      </Boundary>
    </div>
  );
}

async function WorkspaceLoader() {
  const data = await withRequestContext({ route: 'settings-workspace-page' }, async () => {
    const h = await headers();
    let membership: Caller | null;
    try {
      membership = await findCaller(h);
    } catch (error) {
      // Signed out → login, like every settings surface; anything else is real.
      if (error instanceof AppError && error.code === 'UNAUTHENTICATED')
        redirect(await loginRedirectUrl());
      throw error;
    }
    if (!membership) redirect('/app');

    const settings = await getWorkspaceSettings({
      organizationId: membership.organizationId,
      userId: membership.userId,
      role: membership.role,
    });

    // Plan/renewal come straight from the billing projection — never recomputed.
    // Best-effort: a Stripe hiccup degrades the value line rather than the whole page.
    const planRow =
      capabilities.billing.kind === 'stripe' ? await buildPlanRow(h, settings.isAdmin) : null;

    return { settings, planRow, uploadConfig: await uploadConfig(null) };
  });

  const { settings } = data;

  // Role-gated reasons (house rule: controls disable with a reason, never vanish).
  const leaveBlockedReason =
    settings.workspaceCount <= 1
      ? 'This is your only workspace, so you cannot leave it.'
      : settings.isSoleOwner
        ? 'Make someone else an owner before you leave.'
        : null;
  const deleteBlockedReason = !settings.isOwner
    ? 'Only the workspace owner can delete it.'
    : settings.workspaceCount <= 1
      ? 'This is your only workspace, so you cannot delete it.'
      : null;

  const { planRow } = data;

  return (
    <div className="flex flex-col">
      {/* Identity hero cluster — the hero over its plan container, grouped by a
          small gap. The plan container opens the same credit purchase the billing
          page's Add credits does, never a hop through Billing;
          members see the plan line without a control (billing is admin-only). No
          pb here: the large gap before General is General's own pt-12, so the
          rhythm is small (hero→plan) then large (plan→General). */}
      <div className="flex flex-col items-start gap-5">
        <WorkspaceIdentity
          organizationId={settings.organizationId}
          name={settings.name}
          logo={settings.logo}
          canEdit={settings.isAdmin}
          uploadConfig={data.uploadConfig}
        />
        {planRow ? (
          <WorkspacePlanRow
            badge={planRow.badge}
            sentence={planRow.sentence}
            action={planRow.action}
          />
        ) : null}
      </div>

      <SettingsSection title="General" divided={false}>
        <WorkspaceNameRow initialName={settings.name} canEdit={settings.isAdmin} />
      </SettingsSection>

      <WorkspaceDangerZone
        workspaceId={settings.workspaceId}
        workspaceName={settings.name}
        leaveBlockedReason={leaveBlockedReason}
        deleteBlockedReason={deleteBlockedReason}
      />
    </div>
  );
}

// The plan container's contents, from the billing summary. Plans + the credit
// pool are per workspace, so this is the workspace's plan, not the person's.
// `badge` is the uppercase plan name for the pill; `sentence` is the one-line
// statement; `action` picks the right-hand control: 'credits' (a workspace with
// no plan, for an admin) renders the primary Add credits button;
// 'manage' points admins at Billing; null is a plain line (members, who never
// see Billing).
type PlanRow = { badge: string | null; sentence: string; action: PlanAction };

async function buildPlanRow(h: Headers, isAdmin: boolean): Promise<PlanRow> {
  try {
    const [summary, { timeZone }] = await Promise.all([
      getBillingSummary(h),
      getDisplayPreferences(h),
    ]);
    if (summary.planTier !== 'none') {
      const renewing = summary.nextBill
        ? ` Renewing on ${formatDate(summary.nextBill.date, timeZone)}.`
        : '';
      const packageWord =
        summary.planCredits === null ? '' : ` ${formatCount(summary.planCredits)} credits a month.`;
      return {
        badge: summary.planName.toUpperCase(),
        sentence: `You’re on the ${summary.planName} plan.${packageWord}${renewing}`,
        action: isAdmin ? 'manage' : null,
      };
    }
    // Where plans are sold, a workspace without one is offered the plan dialog instead.
    return {
      badge: null,
      sentence: summary.sellsPlans
        ? 'You pay as you go with credits. A plan adds credits every month and raises your limits.'
        : 'You pay as you go with credits.',
      action: isAdmin ? (summary.sellsPlans ? 'plans' : 'credits') : null,
    };
  } catch (error) {
    captureException(error, { route: 'settings-workspace-page', op: 'plan-row' });
    // Degrade: we can't confirm the plan, so drop the badge and state it plainly.
    // Admins still get a way into Billing; members just lose the control.
    return {
      badge: null,
      sentence: 'Your plan details are unavailable right now.',
      action: isAdmin ? 'manage' : null,
    };
  }
}

function WorkspaceError() {
  return (
    <ErrorState
      title="Couldn’t load your workspace"
      message="Something went wrong reading the workspace details. Reload the page to try again."
    />
  );
}
