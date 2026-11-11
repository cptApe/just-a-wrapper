import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from '@/lib/auth';

// Per-request deduped session read. React's `cache()` memoizes for the duration
// of a single server request/render, so the /app segment layout and its child
// layouts ((shell), settings) share ONE `auth.api.getSession` round-trip instead
// of each issuing its own. Zero-arg so every caller hits the same cache entry
// regardless of how it obtained `headers()`. This is what keeps the segment
// layout's workspace-id resolution from adding a net-new auth read per
// navigation on top of the child layout's existing gate.
export const getRequestSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
