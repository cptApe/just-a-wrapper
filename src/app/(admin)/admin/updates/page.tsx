import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { readForkVersion } from '@/features/admin/lib/fork-version';
import { UpdatesAdmin } from '@/features/admin/updates/components/updates-admin';

export const metadata: Metadata = { title: 'Updates' };

export default async function AdminUpdatesPage() {
  return (
    <AdminPage slug="updates">
      <UpdatesAdmin installedVersion={await readForkVersion()} />
    </AdminPage>
  );
}
