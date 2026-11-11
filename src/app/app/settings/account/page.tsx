import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountProfileForm } from '@/features/auth';
import { loginRedirectUrl } from '@/features/auth/lib/login-redirect';
import { storageEnabled } from '@/features/files/api/blob-storage';
import { DeleteAccountSection } from '@/features/workspaces/components/delete-account-section';
import { brand } from '@/lib/brand/identity';
import { withRequestContext } from '@/lib/request-context';
import { getRequestSession } from '@/lib/request-session';
import { capabilities } from '@/lib/runtime-capabilities';

export const metadata: Metadata = {
  title: `Account · ${brand.name}`,
};

export default async function AccountSettingsPage() {
  const data = await withRequestContext({ route: 'settings-account-page' }, async () => {
    const session = await getRequestSession();
    if (!session) redirect(await loginRedirectUrl());
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    };
  });

  return (
    // Use the shell’s standard reading width and padding; md:pt-8 aligns the title with Library.
    <div className="w-full md:pt-8">
      <AccountProfileForm
        userId={data.id}
        initialName={data.name}
        email={data.email}
        image={data.image}
        storageEnabled={storageEnabled()}
        emailEnabled={capabilities.email.kind !== 'off'}
      />
      <DeleteAccountSection email={data.email} />
    </div>
  );
}
