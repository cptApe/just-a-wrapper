import { z } from 'zod';
import type { ChatEvent, RelayFrame } from '@/features/sessions';
import { chatStatusSchema } from '@/lib/chat-status';
import { recordOf } from './record-of';

// Parse every relay frame against the canonical session contract before reducing it.
// Malformed or unknown frames are rejected and reported by the consuming hook.
// Keep parsing pure; its return type checks schema output against RelayFrame.

const chatToolKindSchema = z.enum(['builtin', 'mcp', 'custom']);

const chatFileRefSchema = z.object({
  fileId: z.string(),
  blockType: z.enum(['document', 'image']),
  title: z.string().nullable(),
});

const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
});

const threadDetailSchema = z.discriminatedUnion('sub', [
  z.object({ sub: z.literal('created') }),
  z.object({
    sub: z.literal('status'),
    status: z.enum(['running', 'idle', 'rescheduled', 'terminated']),
  }),
  z.object({
    sub: z.literal('message'),
    direction: z.enum(['sent', 'received']),
    text: z.string(),
  }),
]);

const chatEventSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('message'),
    rawType: z.string(),
    role: z.enum(['user', 'assistant']),
    sendId: z.string().uuid().optional(),
    text: z.string(),
    at: z.string().optional(),
    fileRefs: z.array(chatFileRefSchema).optional(),
    author: z.object({ userId: z.string(), name: z.string() }).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('thinking'),
    rawType: z.string(),
    at: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('tool_use'),
    rawType: z.string(),
    tool: chatToolKindSchema,
    name: z.string(),
    serverName: z.string().optional(),
    input: z.record(z.string(), z.unknown()),
    at: z.string().optional(),
    evaluatedPermission: z.enum(['allow', 'ask', 'deny']).optional(),
    confirmation: z.enum(['allow', 'deny']).optional(),
    threadId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('tool_result'),
    rawType: z.string(),
    toolUseId: z.string(),
    isError: z.boolean(),
    text: z.string(),
    at: z.string().optional(),
    fileRefs: z.array(chatFileRefSchema).optional(),
    threadId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('tool_confirmation'),
    rawType: z.string(),
    toolUseId: z.string(),
    result: z.enum(['allow', 'deny']),
    at: z.string().optional(),
    threadId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('status'),
    rawType: z.string(),
    status: chatStatusSchema,
    stopReason: z.string().optional(),
    at: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('usage'),
    rawType: z.string(),
    usage: tokenUsageSchema,
    at: z.string().optional(),
    startId: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('usage_snapshot'),
    rawType: z.literal('session.usage'),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheCreationTokens: z.number(),
      cacheReadTokens: z.number(),
    }),
    at: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('span_start'),
    rawType: z.string(),
    at: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('error'),
    rawType: z.string(),
    text: z.string(),
    at: z.string().optional(),
    errorType: z.string().optional(),
    retryStatus: z.enum(['retrying', 'exhausted', 'terminal']).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('thread'),
    rawType: z.string(),
    threadId: z.string(),
    agentName: z.string().optional(),
    at: z.string().optional(),
    detail: threadDetailSchema,
  }),
  // The quiet "took control / handed back" whisper the browser panel posts as a
  // fenced user.message (sessions/lib/browser-control.ts). A kind missing from
  // this union is rejected by decodeFrame and dropped from the thread.
  z.object({
    id: z.string(),
    kind: z.literal('browser_control'),
    rawType: z.string(),
    controlledByUser: z.boolean(),
    text: z.string(),
    at: z.string().optional(),
  }),
  z.object({ id: z.string(), kind: z.literal('raw'), rawType: z.string() }),
]);

const relayFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: chatEventSchema }),
  z.object({
    type: z.literal('preview_start'),
    eventId: z.string(),
    previewType: z.enum(['agent.message', 'agent.thinking']),
  }),
  z.object({
    type: z.literal('preview_delta'),
    eventId: z.string(),
    index: z.number(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('meta'),
    sessionId: z.string(),
    traceId: z.string().nullable(),
    lastSeenEventId: z.string().nullable(),
  }),
  z.object({ type: z.literal('history') }),
  z.object({ type: z.literal('heartbeat'), t: z.number() }),
  z.object({ type: z.literal('done'), reason: z.enum(['terminal', 'closed']) }),
  z.object({ type: z.literal('error'), code: z.string() }),
]);

/** A decoded SSE payload that did not match the wire contract. */
type RelayFrameParseFailure = {
  message: string;
  /** Flattened zod issues — safe to log (field names + codes, no raw payload). */
  issues: ReturnType<typeof z.flattenError>;
};

// A ChatEvent kind with no variant above is dropped as malformed, so a missing variant fails the build here.
type ParsedRelayFrame =
  Exclude<ChatEvent['kind'], z.infer<typeof chatEventSchema>['kind']> extends never
    ? RelayFrame
    : never;

type RelayFrameParseResult =
  | { ok: true; frame: ParsedRelayFrame }
  | { ok: false; failure: RelayFrameParseFailure };

const MAX_SHAPE_KEYS = 24;

/** The identifying shape of a decoded payload, for the capture context of a
 * rejected frame: discriminators plus key names only, never field values, so
 * the next contract drift is diagnosable without logging user content. */
type RelayFrameShape = {
  type?: string;
  kind?: string;
  rawType?: string;
  keys: string[];
  eventKeys?: string[];
};

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

export function describeRelayFrameShape(value: unknown): RelayFrameShape {
  const record = recordOf(value);
  if (!record) {
    return { keys: [], type: Array.isArray(value) ? 'array' : typeof value };
  }
  const eventRecord = recordOf(record.event);
  return {
    type: stringField(record, 'type'),
    kind: eventRecord ? stringField(eventRecord, 'kind') : stringField(record, 'kind'),
    rawType: eventRecord ? stringField(eventRecord, 'rawType') : stringField(record, 'rawType'),
    keys: Object.keys(record).slice(0, MAX_SHAPE_KEYS),
    ...(eventRecord ? { eventKeys: Object.keys(eventRecord).slice(0, MAX_SHAPE_KEYS) } : {}),
  };
}

/**
 * Validate one already-decoded SSE payload against the relay wire contract.
 * Never throws — a frame the schema rejects comes back as `{ ok: false }` with a
 * reportable failure, so the stream consumer can report + skip and stay live.
 * JSON decoding (and its own failure handling) is the caller's concern: this
 * stays pure of I/O and observability so it is unit-testable in isolation.
 */
export function safeParseRelayFrame(value: unknown): RelayFrameParseResult {
  const result = relayFrameSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      failure: {
        message: 'SSE relay frame did not match the wire contract',
        issues: z.flattenError(result.error),
      },
    };
  }
  return { ok: true, frame: result.data };
}
