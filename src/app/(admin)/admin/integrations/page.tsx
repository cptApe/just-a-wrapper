import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { IntegrationsAdmin } from '@/features/integrations/components/integrations-admin';

export const metadata: Metadata = { title: 'Integrations' };

export default function AdminIntegrationsPage() {
  return (
    <AdminPage slug="integrations">
      <IntegrationsAdmin />
    </AdminPage>
  );
}
