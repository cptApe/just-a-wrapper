import 'server-only';

// Compare persisted events with seen stream events to distinguish a stalled
// connection from an idle session. Keep verdict logic separate for tests with fake clients.

/** How old an undelivered persisted event must be before the stream is declared
    stalled — absorbs the normal persist→stream delivery lag so a healthy stream
    is never torn down over an event that is still in flight to us. */
export const STALL_GRACE_MS = 10_000;

/** Probe requests carry their own tight timeout: the probe runs inside the live
    heartbeat loop, so a hung probe (SDK default timeout: 10 MINUTES) would wedge
    the relay exactly like the hung upstreams it exists to detect. */
export const STALL_PROBE_TIMEOUT_MS = 10_000;

// Limit the stall probe to the SDK event-list network boundary so delivery behavior can be tested
// without opening a real stream.
export type StallProbeClient = {
  beta: {
    sessions: {
      events: {
        list(
          sessionId: string,
          params: { order: 'desc'; limit: number },
          options: { timeout: number },
        ): Promise<{ data: ReadonlyArray<{ id: string; processed_at?: string | null }> }>;
      };
    };
  };
};

// Only an unseen event older than the delivery grace proves a stall. History seeds the seen set
// before the live pump starts.
export async function isStreamStalled(
  client: StallProbeClient,
  sessionId: string,
  seen: ReadonlySet<string>,
): Promise<boolean> {
  const page = await client.beta.sessions.events.list(
    sessionId,
    { order: 'desc', limit: 1 },
    { timeout: STALL_PROBE_TIMEOUT_MS },
  );
  const newest = page.data.at(0);
  if (!newest || seen.has(newest.id)) return false;
  const processedAt = Date.parse(newest.processed_at ?? '');
  if (!Number.isFinite(processedAt)) return false;
  return Date.now() - processedAt > STALL_GRACE_MS;
}
