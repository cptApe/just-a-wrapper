import { rowActionClass } from '@/components/settings/row-action';
import { SettingsDetailRowSkeleton } from '@/components/settings/settings-detail-row-skeleton';
import { SettingsPageHeader } from '@/components/settings/settings-page-header';
import { SettingsSection } from '@/components/settings/settings-section';
import { Skeleton, SkeletonText } from '@/components/ui/skeleton';

// Payment rows reserved while history loads; most paying workspaces have a few.
const HISTORY_ROWS = 3;

// Mirrors the Billing page for the common case, a workspace on a paid,
// subscribed plan: Plan, Credits, Automatic top-ups and Payment rows, then the
// payment history. Static labels and row actions render as real text.
export function BillingPageSkeleton() {
  return (
    <div className="w-full md:pt-8" aria-busy="true" aria-label="Loading billing">
      <SettingsPageHeader title="Billing" />
      <div className="pt-8">
        <SettingsSection title="Subscription" divided={false}>
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Plan"
            value={<SkeletonText>Pro · 5,000 credits a month · $20 a month</SkeletonText>}
            trailing="Edit"
          />
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Credits"
            valueWidth="11rem"
            trailing="Add credits"
          />
          {/* Automatic top-ups default to off, so the value is one short word. */}
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Automatic top-ups"
            valueWidth="1.5rem"
            trailing="Edit"
          />
          <SettingsDetailRowSkeleton
            layout="stacked"
            label="Payment"
            value="Handled by Stripe"
            trailing={
              <span aria-hidden className={rowActionClass()}>
                Manage billing
              </span>
            }
          />
        </SettingsSection>
        <SettingsSection title="Billing history" divided={false}>
          <div className="flex flex-col">
            {Array.from({ length: HISTORY_ROWS }, (_, index) => (
              // Same geometry as a BillingHistorySection row: description over
              // date on the left, amount and Receipt on the right.
              <div key={index} className="flex items-center justify-between gap-4 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex h-[22px] items-center">
                    <Skeleton className="h-3.5 w-40 rounded-sm" />
                  </div>
                  <div className="flex h-[18px] items-center">
                    <Skeleton className="h-3 w-20 rounded-sm" />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="flex h-[22px] items-center">
                    <Skeleton className="h-3.5 w-14 rounded-sm" />
                  </div>
                  <span aria-hidden className={rowActionClass()}>
                    Receipt
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}
