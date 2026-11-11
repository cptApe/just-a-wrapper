import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { OverviewAdmin } from '@/features/admin/overview/components/overview-admin';

export const metadata: Metadata = { title: 'Overview' };

// Each row describes the machine serving the request, not the one that built it.
export const dynamic = 'force-dynamic';

export default function AdminOverviewPage() {
  return (
    <AdminPage slug="overview">
      <OverviewAdmin />
    </AdminPage>
  );
}
