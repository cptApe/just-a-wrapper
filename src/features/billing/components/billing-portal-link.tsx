'use client';

import { rowActionClass } from '@/components/settings/row-action';

export function BillingPortalLink({ href }: { href: string }) {
  return (
    <a className={rowActionClass()} href={href}>
      Manage billing
    </a>
  );
}
