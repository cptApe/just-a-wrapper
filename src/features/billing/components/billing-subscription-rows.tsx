'use client';

import { useState } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { useDisplayFormat } from '@/components/providers/display-format-provider';
import { RowAction } from '@/components/settings/row-action';
import { SettingsDetailRow } from '@/components/settings/settings-detail-row';
import { openOverlay } from '@/features/overlays/lib/overlay-history';
import { formatShortDate } from '@/lib/format/format-date';
import { formatCount } from '@/lib/format/format-number';
import type { BillingSummary } from '../api/get-billing-summary';
import { usePlanCancel } from '../hooks/use-plan-purchase';
import { PLANS } from '../pricing-config';
import { AutoTopupSettings } from './auto-topup-settings';

export function BillingSubscriptionRows({
  summary,
  planValue,
  creditValue,
}: {
  summary: BillingSummary;
  /** The current subscription in one line, or null for a workspace without a plan. */
  planValue: string | null;
  creditValue: string;
}) {
  const [autoOpen, setAutoOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  return (
    <>
      {summary.sellsPlans ? (
        <PlanRows summary={summary} planValue={planValue} />
      ) : planValue === null ? null : (
        <SettingsDetailRow layout="stacked" label="Plan" value={planValue} />
      )}
      <SettingsDetailRow
        layout="stacked"
        label="Credits"
        value={<span className="tabular-nums">{creditValue}</span>}
        action={
          <RowAction className="min-w-[3.25rem] text-right" onClick={() => openOverlay('topup')}>
            Add credits
          </RowAction>
        }
      />
      {planValue === null ? null : (
        <AutoTopupSettings
          key={revision}
          initial={summary.autoTopup}
          open={autoOpen}
          onOpenChange={(next) => {
            setAutoOpen(next);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

// Where plans are sold, the plan row opens the plan dialog, and a plan can be cancelled and resumed.
function PlanRows({ summary, planValue }: { summary: BillingSummary; planValue: string | null }) {
  const organizationId = useOrganizationId();
  const { timeZone } = useDisplayFormat();
  const cancel = usePlanCancel(organizationId ?? '');
  const subscription = summary.subscription;
  const cancelsAt = subscription?.cancelsAt ?? null;
  const scheduled = subscription?.scheduledChange ?? null;
  const helper = subscription?.pastDue
    ? 'Your last payment failed. Update your card below to keep your plan.'
    : cancelsAt
      ? `Ends on ${formatShortDate(cancelsAt, timeZone)}. Your bought credits stay.`
      : scheduled
        ? `Changes to ${PLANS[scheduled.tier].name}, ${formatCount(scheduled.credits)} credits a month, on ${formatShortDate(scheduled.startsAt, timeZone)}.`
        : undefined;

  return (
    <>
      <SettingsDetailRow
        layout="stacked"
        label="Plan"
        value={planValue ?? 'No plan'}
        helper={helper}
        action={
          <RowAction className="text-right" onClick={() => openOverlay('plans')}>
            {planValue === null ? 'Choose a plan' : 'Change'}
          </RowAction>
        }
      />
      {planValue !== null && summary.isSubscribed && organizationId !== null ? (
        <SettingsDetailRow
          layout="stacked"
          label="Renewal"
          value={cancelsAt ? 'Cancelled at the end of this period' : 'Renews automatically'}
          action={
            <RowAction
              className="text-right"
              destructive={cancelsAt === null}
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(cancelsAt !== null)}
            >
              {cancelsAt ? 'Resume plan' : 'Cancel plan'}
            </RowAction>
          }
        />
      ) : null}
    </>
  );
}
