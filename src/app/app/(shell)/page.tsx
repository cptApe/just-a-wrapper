import { HomeView } from '@/features/chat';
import { loadHomePage } from '@/features/chat/api/load-home-page';
import { HomeWorkspaceMissing } from '@/features/chat/components/home-workspace-missing';
import { brand } from '@/lib/brand/identity';

export const metadata = { title: `${brand.name} · home` };

export default async function AppHome() {
  const home = await loadHomePage();
  return home.kind === 'ready' ? (
    <HomeView key={home.organizationId} {...home} />
  ) : (
    <HomeWorkspaceMissing greeting={home.greeting} />
  );
}
