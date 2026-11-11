'use server';

import { headers } from 'next/headers';
import { getBillingSummary } from '@/features/billing';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';

export async function loadComposerCredits() {
  return withRequestContext({ route: 'chat/composer-credits', feature: 'chat' }, async () => {
    if (capabilities.billing.kind === 'off') return { kind: 'off' as const };
    const summary = await getBillingSummary(await headers());
    return {
      kind: 'ready' as const,
      creditBalance: summary.creditBalance,
      hasPlan: summary.isSubscribed,
    };
  });
}
