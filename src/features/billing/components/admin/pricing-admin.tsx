import { AdminRowList, AdminRuleRow, AdminValueRow } from '@/components/admin/admin-rows';
import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import { Boundary } from '@/components/layouts/boundary';
import { typicalTurnSentence } from '../../lib/charge-rows';
import { creditRuleRows, marginSummary } from '../../lib/pricing-admin-model';
import { pricingAdminPromptText } from '../../lib/pricing-admin-prompt';
import { PricingAdminCharges } from './pricing-admin-charges';
import { PricingAdminPlans } from './pricing-admin-plans';
import {
  PricingAdminStripe,
  StripeReconciliation,
  StripeReconciliationFallback,
  StripeReconciliationSkeleton,
} from './pricing-admin-stripe';
import { PricingAdminVendorBills } from './pricing-admin-vendor-bills';

export function PricingAdmin() {
  const margin = marginSummary();

  return (
    <>
      <AdminSection
        title="Your margin"
        action={
          <AdminAgentButton
            action="change your prices"
            text={pricingAdminPromptText()}
            op="admin.copy-pricing-prompt"
          />
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <p className="text-title-page tabular-nums">{margin.headline}</p>
            <p className="text-body text-muted-foreground">{margin.sentence}</p>
          </div>
          <AdminRowList>
            {margin.rows.map((row) => (
              <AdminValueRow key={row.label} label={row.label} value={row.value} />
            ))}
          </AdminRowList>
        </div>
      </AdminSection>

      <AdminSection
        title="Your plans"
        support="Both plans charge the same for a credit. They differ by their smallest package and by what they let a customer run."
      >
        <PricingAdminPlans />
      </AdminSection>

      <AdminSection title="What gets charged" support={typicalTurnSentence()}>
        <PricingAdminCharges />
      </AdminSection>

      <AdminSection title="Credit rules">
        <AdminRowList>
          {creditRuleRows().map((row) => (
            <AdminRuleRow key={row.label} label={row.label} value={row.value} />
          ))}
        </AdminRowList>
      </AdminSection>

      <AdminSection
        title="Your vendor bills"
        support="Every service below is paid. Each has a free tier that covers a small app and a bill that grows with use."
      >
        <PricingAdminVendorBills />
      </AdminSection>

      <PricingAdminStripe
        reconciliation={
          <Boundary
            loading={<StripeReconciliationSkeleton />}
            error={<StripeReconciliationFallback />}
          >
            <StripeReconciliation />
          </Boundary>
        }
      />
    </>
  );
}
