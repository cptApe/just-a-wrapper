/** The relay emits a heartbeat every 25s while its upstream is quiet. Allow
 *  another 10s for timer/network jitter before treating a running stream as
 *  silent and replacing its socket. */
export const STREAM_STALE_MS = 35_000;

const STREAM_RECOVERY_MAX_DELAY_MS = 30_000;

/** Pure timestamp decision used by the hook's stale-running recovery loop and
 *  by send-time recovery. */
export function isStreamQuietStale(
  lastFrameAt: number,
  now: number,
  staleAfterMs = STREAM_STALE_MS,
): boolean {
  return now - lastFrameAt >= staleAfterMs;
}

/** Match the transport probe's recovery cadence: 1s, 2s, 4s, …, capped at 30s. */
export function streamRecoveryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, STREAM_RECOVERY_MAX_DELAY_MS);
}
