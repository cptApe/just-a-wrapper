import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { SkillsAdmin } from '@/features/skills/components/skills-admin';

export const metadata: Metadata = { title: 'Skills' };

export default function AdminSkillsPage() {
  return (
    <AdminPage slug="skills">
      <SkillsAdmin />
    </AdminPage>
  );
}
