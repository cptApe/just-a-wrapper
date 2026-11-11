import type { Metadata } from 'next';
import { AnalyticsAdmin } from '@/features/admin/analytics/components/analytics-admin';
import { AdminPage } from '@/features/admin/components/admin-page';

export const metadata: Metadata = { title: 'Analytics' };

// The status section reads which keys this machine has.
export const dynamic = 'force-dynamic';

export default function AdminAnalyticsPage() {
  return (
    <AdminPage slug="analytics">
      <AnalyticsAdmin />
    </AdminPage>
  );
}
