import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { AdminStatusBanner } from '@/components/admin/status-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { withRequestContext } from '@/lib/request-context';
import type { StripeCatalogReconciliation } from '../../api/reconcile-stripe-catalog';
import { reconcileStripeCatalog } from '../../api/reconcile-stripe-catalog';
import { catalogSentence } from '../../lib/pricing-admin-model';
import { stripeSeedPromptText } from '../../lib/pricing-admin-prompt';

function StripeStatusRow({ matches }: { matches: boolean }) {
  return (
    <AdminStatusBanner
      tone={matches ? 'ready' : 'attention'}
      action={
        matches ? undefined : (
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <AdminAgentButton
              action="fix your Stripe catalog"
              text={stripeSeedPromptText()}
              op="admin.copy-stripe-fix-prompt"
            />
            <p className="text-meta font-medium text-warning">This changes your Stripe account</p>
          </div>
        )
      }
    >
      {matches ? 'Stripe matches your prices' : 'Stripe is out of date'}
    </AdminStatusBanner>
  );
}

function ReconciliationState({ result }: { result: StripeCatalogReconciliation }) {
  if (result.status === 'plans-not-sold') {
    return (
      <AdminStatusBanner tone="ready">
        Credits only: top-ups need no Stripe prices
      </AdminStatusBanner>
    );
  }
  return <StripeStatusRow matches={result.status === 'in-sync'} />;
}

export async function StripeReconciliation() {
  const result = await withRequestContext({ route: 'admin-pricing-page' }, () =>
    reconcileStripeCatalog(),
  );
  return <ReconciliationState result={result} />;
}

export function StripeReconciliationSkeleton() {
  return <Skeleton className="h-[54px] w-full rounded-xl" />;
}

export function StripeReconciliationFallback() {
  return (
    <p className="text-body text-muted-foreground">We could not check Stripe. Reload the page.</p>
  );
}

export function PricingAdminStripe({ reconciliation }: { reconciliation: React.ReactNode }) {
  return (
    <AdminSection title="Payments" support={catalogSentence()}>
      {reconciliation}
    </AdminSection>
  );
}
