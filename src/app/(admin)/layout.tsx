import type { Metadata } from 'next';
import { brand } from '@/lib/brand/identity';
import { requireAdminAccess } from './admin-access';

// The title template lives here because Next applies a template to deeper
// segments only: declared in `admin/layout.tsx`, it would skip Overview.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: { template: `%s · ${brand.name}`, default: brand.name },
};

// Route handlers bypass layouts and call the same gate themselves.
export default async function AdminRouteGroupLayout({ children }: { children: React.ReactNode }) {
  await requireAdminAccess();
  return <>{children}</>;
}
