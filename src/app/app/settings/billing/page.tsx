import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ErrorState } from '@/components/layouts/error-state';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';
import {
  type BillingMemberLimit,
  type BillingSummary,
  listBillingMemberLimits,
  listPaymentHistory,
  loadBillingWorkspace,
  type PaymentHistoryEntry,
  summarizeBilling,
} from '@/features/billing';
import { BillingHistorySection } from '@/features/billing/components/billing-history-section';
import { BillingPortalLink } from '@/features/billing/components/billing-portal-link';
import { BillingReturn } from '@/features/billing/components/billing-return';
import { BillingSubscriptionRows } from '@/features/billing/components/billing-subscription-rows';
import { MemberLimitsSection } from '@/features/billing/components/member-limits-section';
import { toPaymentHistoryRow } from '@/features/billing/lib/payment-history-row';
import { planSummaryLine } from '@/features/billing/lib/plan-picker-packs';
import { getDisplayPreferences } from '@/features/preferences/api/get-preferences';
import { brand } from '@/lib/brand/identity';
import { resolveCaller } from '@/lib/caller';
import { AuthorizationError } from '@/lib/errors';
import { formatShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';

export const metadata: Metadata = {
  title: `Billing · ${brand.name}`,
};

const PORTAL_HREF = '/api/billing/portal';

export const dynamic = 'force-dynamic';

export default async function BillingSettingsPage() {
  if (capabilities.billing.kind === 'off') notFound();
  const access = await withRequestContext(
    { route: 'settings-billing-access', feature: 'billing' },
    async () => {
      try {
        const h = await headers();
        const caller = await resolveCaller(h, { atLeast: 'admin' });
        const [workspace, { timeZone }] = await Promise.all([
          loadBillingWorkspace(caller),
          getDisplayPreferences(h),
        ]);
        const isOwner = caller.role === 'owner';
        return { workspace, isOwner, timeZone };
      } catch (error) {
        if (error instanceof AuthorizationError) return null;
        throw error;
      }
    },
  );
  if (!access) {
    return (
      <ErrorState
        title="You don’t have access"
        message="Only workspace owners and admins can manage billing."
      />
    );
  }

  const { summary, history, memberLimits } = await withRequestContext(
    { route: 'settings-billing-page', feature: 'billing' },
    async () => {
      const { workspace } = access;
      let summary: BillingSummary | null = null;
      try {
        summary = await summarizeBilling(workspace);
      } catch (error) {
        captureException(error, { route: 'settings-billing-page', op: 'summary' });
      }
      // Payment history is best-effort too: null = the Stripe read failed (the
      // section shows a quiet degraded line); [] = no payments yet (empty state).
      let history: PaymentHistoryEntry[] | null = null;
      try {
        history = await listPaymentHistory(workspace);
      } catch (error) {
        captureException(error, { route: 'settings-billing-page', op: 'history' });
      }
      let memberLimits: BillingMemberLimit[] | null | undefined = null;
      try {
        memberLimits = await listBillingMemberLimits(workspace);
      } catch (error) {
        if (error instanceof AuthorizationError) memberLimits = undefined;
        else captureException(error, { route: 'settings-billing-page', op: 'member-limits' });
      }
      return { summary, history, memberLimits };
    },
  );

  // Format money + dates server-side so the client "Show more" component only renders strings.
  // null stays null (degraded).
  const historyRows =
    history === null ? null : history.map((entry) => toPaymentHistoryRow(entry, access.timeZone));

  if (!summary) {
    return (
      // Fill the shell’s standard Library-width column; md:pt-8 aligns the title.
      <div className="w-full md:pt-8">
        <SettingsPageHeader title="Billing" />
        <div className="pt-8">
          <p className="text-body text-muted-foreground" role="alert">
            Billing is unavailable right now. Refresh to try again. Your plan and credits are
            unaffected.
          </p>
        </div>
      </div>
    );
  }

  const hasPlan = summary.planTier !== 'none';
  const planValue = hasPlan
    ? planSummaryLine({
        planName: summary.planName,
        credits: summary.planCredits,
        interval: summary.planInterval === 'year' ? 'year' : 'month',
        priceCents: summary.planPriceCents,
        currency: summary.planPriceCurrency,
      })
    : null;

  return (
    <div className="w-full md:pt-8">
      <BillingReturn key={summary.workspaceId} />
      <SettingsPageHeader title="Billing" />

      <div className="pt-8">
        <SettingsSection
          title={hasPlan || summary.sellsPlans ? 'Subscription' : 'Credits'}
          divided={false}
        >
          <BillingSubscriptionRows
            key={summary.workspaceId}
            summary={summary}
            planValue={planValue}
            creditValue={`${formatCount(summary.creditBalance)} left${summary.creditResetAt ? ` · Resets ${formatShortDate(summary.creditResetAt, access.timeZone)}` : ''}`}
          />
          {hasPlan && summary.isSubscribed ? (
            <SettingsDetailRow
              layout="stacked"
              label="Payment"
              value="Handled by Stripe"
              action={<BillingPortalLink href={PORTAL_HREF} />}
            />
          ) : null}
        </SettingsSection>
        {memberLimits !== undefined && (memberLimits === null || memberLimits.length > 1) ? (
          <SettingsSection title="Members">
            {memberLimits ? (
              <MemberLimitsSection key={summary.workspaceId} members={memberLimits} />
            ) : (
              <p className="text-body text-muted-foreground" role="alert">
                Member limits are unavailable right now.
              </p>
            )}
          </SettingsSection>
        ) : null}
        <SettingsSection title="Billing history" divided={false}>
          <BillingHistorySection rows={historyRows} />
        </SettingsSection>
      </div>
    </div>
  );
}
