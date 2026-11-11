import { PRIVACY_TITLE, privacyDocument } from '@content/legal';
import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/legal-page';
import { readContactDetails } from '@/lib/brand/contact';
import { brand } from '@/lib/brand/identity';
import { withRequestContext } from '@/lib/request-context';

export const metadata: Metadata = {
  title: PRIVACY_TITLE,
  description: `Read the ${PRIVACY_TITLE.toLowerCase()} for using ${brand.name}.`,
};

// The contact address can change in the admin console, so the page reads it on each request.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const contact = await withRequestContext({ route: 'privacy-page' }, readContactDetails);
  return (
    <LegalPage
      document={privacyDocument({ name: brand.name, supportEmail: contact.supportEmail })}
    />
  );
}
