'use client';

import posthog from 'posthog-js';
import { useEffect } from 'react';
import { resetIdentity } from '@/lib/analytics-client';
import { authClient } from '@/lib/auth-client';
import { env } from '@/lib/env';

let identifiedUserId: string | undefined;

export function PostHogIdentify(): null {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (!userId) return;
    // Preserve anonymous-to-user stitching; only a different identified account needs a reset.
    if (
      identifiedUserId !== undefined &&
      identifiedUserId !== userId &&
      posthog.get_distinct_id() === identifiedUserId
    )
      resetIdentity();
    posthog.identify(userId);
    identifiedUserId = userId;
  }, [userId]);

  return null;
}
