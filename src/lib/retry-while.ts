import { setTimeout as delay } from 'node:timers/promises';

// Each entry in `delays` is one wait, so the work runs at most `delays.length + 1` times.
export async function retryWhile<T>(
  attempt: () => Promise<T>,
  { isRetryable, delays }: { isRetryable: (error: unknown) => boolean; delays: readonly number[] },
): Promise<T> {
  for (const wait of delays) {
    try {
      return await attempt();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      await delay(wait);
    }
  }
  return attempt();
}
