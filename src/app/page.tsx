import { redirect } from 'next/navigation';
import { HomeLanding } from '@/features/landing';
import { getRequestSession } from '@/lib/request-session';

export default async function HomePage() {
  const session = await getRequestSession();
  if (session) redirect('/app');

  return <HomeLanding />;
}
