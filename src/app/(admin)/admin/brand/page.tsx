import type { Metadata } from 'next';
import { BrandAdmin } from '@/features/admin/brand';
import { AdminPage } from '@/features/admin/components/admin-page';
import { ContactSettingsAdmin } from '@/features/admin/settings/components/contact-settings-admin';
import { updateDeploymentSettingAction } from '../deployment-setting-actions';

export const metadata: Metadata = { title: 'Brand' };

// The contact section reads the deployment settings in the database.
export const dynamic = 'force-dynamic';

export default function AdminBrandPage() {
  return (
    <AdminPage slug="brand">
      <BrandAdmin contact={<ContactSettingsAdmin save={updateDeploymentSettingAction} />} />
    </AdminPage>
  );
}
