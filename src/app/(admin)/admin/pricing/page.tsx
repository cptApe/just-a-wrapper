import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { BillingModeAdmin } from '@/features/admin/settings/components/billing-mode-admin';
import { PricingAdmin } from '@/features/billing/components/admin/pricing-admin';
import { updateDeploymentSettingAction } from '../deployment-setting-actions';

export const metadata: Metadata = { title: 'Pricing' };

// The Stripe reconciliation reads a live account, and the billing mode reads the database.
export const dynamic = 'force-dynamic';

export default function AdminPricingPage() {
  return (
    <AdminPage slug="pricing">
      <BillingModeAdmin save={updateDeploymentSettingAction} />
      <PricingAdmin />
    </AdminPage>
  );
}
