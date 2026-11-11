import 'server-only';
import { setTimeout as delay } from 'node:timers/promises';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { member, realtimeEvent } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { SSE_PRELUDE } from '@/lib/sse';
import {
  STREAM_BATCH_LIMIT,
  STREAM_KEEPALIVE_MS,
  STREAM_LIFETIME_MS,
  STREAM_POLL_MS,
  STREAM_REPLAY_MS,
} from '../constants';
import { eventAudienceQuery } from '../lib/audience';
import { reduceServerStream, type ServerStreamState } from '../lib/server-stream-machine';

type StreamMember = { organizationId: string; userId: string };
const streamParameters = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .pipe(z.string().refine((value) => BigInt(value) <= 9223372036854775807n))
    .nullable(),
});
export async function realtimeStream(request: Request, identity: StreamMember): Promise<Response> {
  const url = new URL(request.url);
  const parsed = streamParameters.safeParse({
    cursor: request.headers.get('last-event-id') ?? url.searchParams.get('last_event_id'),
  });
  if (!parsed.success) throw new AppError('INVALID_BODY', 'Invalid stream cursor', {});
  const cursor = await initialCursor(identity.organizationId, parsed.data.cursor);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const encoder = new TextEncoder();
  let state: ServerStreamState = { phase: 'polling' };
  const stream = new ReadableStream<Uint8Array>({
    async start(output) {
      // EventSource discards a frame with no data.
      output.enqueue(encoder.encode(`${SSE_PRELUDE}event: cursor\nid: ${cursor}\ndata: {}\n\n`));
      try {
        await pollEvents({ identity, cursor, signal, output });
      } catch (error) {
        if (!signal.aborted) {
          captureException(error, { op: 'realtime-stream' });
          state = reduceServerStream(state, 'cancel');
          output.error(error);
          return;
        }
      }
      // A request abort stops polling; only consumer cancellation closes the output itself.
      state = reduceServerStream(state, 'finish');
      if (state.phase === 'closing') {
        output.close();
        state = reduceServerStream(state, 'close');
      }
    },
    cancel() {
      state = reduceServerStream(state, 'cancel');
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}

async function initialCursor(organizationId: string, requested: string | null): Promise<bigint> {
  if (requested !== null) {
    const row = await db.query.realtimeEvent.findFirst({
      where: and(
        eq(realtimeEvent.organizationId, organizationId),
        eq(realtimeEvent.id, BigInt(requested)),
        gte(realtimeEvent.createdAt, new Date(Date.now() - STREAM_REPLAY_MS)),
      ),
    });
    if (row) return row.id;
  }
  const latest = (
    await db
      .select({ id: realtimeEvent.id })
      .from(realtimeEvent)
      .where(eq(realtimeEvent.organizationId, organizationId))
      .orderBy(desc(realtimeEvent.id))
      .limit(1)
  ).at(0);
  return latest?.id ?? 0n;
}

async function pollEvents({
  identity,
  cursor,
  signal,
  output,
}: {
  identity: StreamMember;
  cursor: bigint;
  signal: AbortSignal;
  output: ReadableStreamDefaultController<Uint8Array>;
}) {
  const encoder = new TextEncoder();
  const deadline = Date.now() + STREAM_LIFETIME_MS;
  let lastKeepalive = 0;
  while (!signal.aborted && Date.now() < deadline) {
    const membership = await db.query.member.findFirst({
      where: and(
        eq(member.organizationId, identity.organizationId),
        eq(member.userId, identity.userId),
      ),
    });
    if (!membership) break;
    if (Date.now() - lastKeepalive >= STREAM_KEEPALIVE_MS) {
      output.enqueue(encoder.encode(': keepalive\n\n'));
      lastKeepalive = Date.now();
    }
    const rows = await eventsAfter(identity, cursor, membership.createdAt);
    for (const row of rows) {
      signal.throwIfAborted();
      output.enqueue(encoder.encode(`id: ${row.id}\ndata: ${JSON.stringify(row.payload)}\n\n`));
      cursor = row.id;
    }
    if (rows.length < STREAM_BATCH_LIMIT) await delay(STREAM_POLL_MS, undefined, { signal });
  }
}

async function eventsAfter(identity: StreamMember, cursor: bigint, joinedAt: Date) {
  const rows = await db
    .select()
    .from(realtimeEvent)
    .where(
      and(
        eventAudienceQuery(identity.organizationId, identity.userId, cursor),
        gte(
          realtimeEvent.createdAt,
          new Date(Math.max(joinedAt.getTime(), Date.now() - STREAM_REPLAY_MS)),
        ),
      ),
    )
    .orderBy(realtimeEvent.id)
    .limit(STREAM_BATCH_LIMIT);
  return rows;
}
