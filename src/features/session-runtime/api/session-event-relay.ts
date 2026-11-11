import 'server-only';
import { after } from 'next/server';
import { createBackgroundWork } from '@/features/sessions/api/create-background-work';
import { encodeFrame } from '@/features/sessions/lib/sse';
import type { RelayFrame } from '@/features/sessions/types';
import { snapshotCtx } from '@/lib/request-context';
import { SSE_PRELUDE } from '@/lib/sse';
import { type RelayInput, relayFrames } from './relay-frames';

export function sessionEventStream(input: RelayInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const work = createBackgroundWork(snapshotCtx(), input.sessionId);
  // Register after inside the request scope; stream callbacks run later and cannot register it. Keep
  // the request alive until all scheduled work drains.
  after(() => work.settled());
  const cancellation = new AbortController();
  const frames = relayFrames(
    { ...input, signal: AbortSignal.any([input.signal, cancellation.signal]) },
    work,
  );
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Flush a comment immediately so intermediary proxies don't buffer headers.
      controller.enqueue(encoder.encode(SSE_PRELUDE));
    },
    async pull(controller) {
      let next: IteratorResult<RelayFrame, void>;
      try {
        next = await frames.next();
      } catch (error) {
        // Close the work queue even when opening the generator fails, so the registered after callback can
        // settle.
        work.close();
        throw error;
      }
      if (next.done) {
        work.close();
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeFrame(next.value)));
    },
    async cancel() {
      // Browser disconnected — stop consuming upstream and release the SDK
      // stream. close() also covers the never-started case, where the
      // generator's own finally would not run.
      cancellation.abort();
      work.close();
      await frames.return(undefined);
      work.close();
    },
  });
}
