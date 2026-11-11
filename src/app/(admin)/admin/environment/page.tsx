import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AdminPage } from '@/features/admin/components/admin-page';
import { getStripeWebhookStatus } from '@/features/admin/environment/api/get-stripe-webhook-status';
import { EnvironmentAdmin } from '@/features/admin/environment/components/environment-admin';
import { getOptionalDisplayPreferences } from '@/features/preferences/api/get-preferences';
import { withRequestContext } from '@/lib/request-context';

export const metadata: Metadata = { title: 'Environment' };

// Whether a key is set depends on the machine serving the request.
export const dynamic = 'force-dynamic';

export default async function AdminEnvironmentPage() {
  const [stripeWebhook, displayFormat] = await withRequestContext(
    { route: 'admin-environment-page', feature: 'admin' },
    async () =>
      Promise.all([getStripeWebhookStatus(), getOptionalDisplayPreferences(await headers())]),
  );
  return (
    <AdminPage slug="environment">
      <EnvironmentAdmin stripeWebhook={stripeWebhook} displayFormat={displayFormat} />
    </AdminPage>
  );
}
