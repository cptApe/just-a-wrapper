import type { Metadata } from 'next';
import { AdminPage } from '@/features/admin/components/admin-page';
import { readThemeTokens } from '@/features/theme/api/read-theme-tokens';
import { ThemeReference } from '@/features/theme/components/theme-reference';
import { withRequestContext } from '@/lib/request-context';

export const metadata: Metadata = { title: 'Theme' };

export default async function AdminThemePage() {
  const tokens = await withRequestContext({ route: 'admin/theme' }, readThemeTokens);
  return (
    <AdminPage slug="theme">
      <ThemeReference tokens={tokens} />
    </AdminPage>
  );
}
