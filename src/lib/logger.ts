// One redacted server log sink for stdout and OTLP, bound to request context.

import { SeverityNumber } from '@opentelemetry/api-logs';
import pino from 'pino';
import { env } from './env';
import { serializeError } from './errors';
import { lazyValue } from './lazy-value';
import { captureException } from './observability';
import { otelLogger } from './otel-logs';
import { ctx } from './request-context';
import { sanitize, sanitizeString } from './sanitize';

const getBase = lazyValue(() =>
  pino({
    level: env.LOG_LEVEL,
    formatters: {
      level: (label) => ({ level: label }),
      bindings: sanitize,
      log: sanitize,
    },
    // The final pass also covers interpolated messages and child msgPrefix.
    hooks: { streamWrite: (line) => `${JSON.stringify(sanitize(JSON.parse(line)))}\n` },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
);

// Returns a request-bound logger. Audit sinks with their own field allowlist can
// opt out of automatic context inheritance and bind only approved fields.
export function logger({
  inheritRequestContext = true,
}: {
  inheritRequestContext?: boolean;
} = {}): pino.Logger {
  return getBase().child(inheritRequestContext ? (ctx() ?? {}) : {});
}

// Better Auth hands this sink failed query errors with their bound values. The
// pino formatters redact the details and the final write redacts the message.
export function logBetterAuth(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  ...details: unknown[]
): void {
  logger()[level]({ details }, message);
}

type LogLevel = 'info' | 'warn' | 'error';

export type LogRecordInput = {
  msg: string;
  level?: LogLevel;
  feature?: string;
  op?: string;
  duration_ms?: number;
  error?: unknown;
  [key: string]: unknown;
};

type ShipLogOptions = {
  inheritRequestContext?: boolean;
};

const SEVERITY: Record<LogLevel, SeverityNumber> = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

// Build the canonical, flat log payload: ctx fields first, then the call-site
// record (record wins on conflict), with any error serialized.
function buildLogPayload(
  ctxFields: Record<string, unknown>,
  input: LogRecordInput,
): Record<string, unknown> {
  // `level` is log metadata (pino/OTLP carry it out-of-band), not a payload
  // field; drop it. Serialize any error into the canonical {name,code,...} shape.
  const { error, ...rest } = input;
  delete rest.level;
  const payload: Record<string, unknown> = { ...ctxFields, ...rest };
  if (error !== undefined) payload.error = serializeError(error);
  return sanitize(payload);
}

// Flatten to OTLP attribute values (primitives pass through; objects/arrays are
// JSON-stringified, since OTLP log attributes are a flat AnyValue map).
function toAttributes(payload: Record<string, unknown>): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    attrs[key] =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : JSON.stringify(value);
  }
  return attrs;
}

// Ship one log record to stdout + PostHog Logs. Never throws — observability
// must not take down the work it observes (the mirror runs this in waitUntil).
export function shipLog(
  input: LogRecordInput,
  { inheritRequestContext = true }: ShipLogOptions = {},
): void {
  const level: LogLevel = input.level ?? 'info';
  const ctxFields = inheritRequestContext ? (ctx() ?? {}) : {};

  // Telemetry failure must not interrupt user work; the error sink owns recovery.
  try {
    // The stdout logger already inherits request context.
    logger({ inheritRequestContext })[level](buildLogPayload({}, input));

    // PostHog Logs over OTLP: the OTel logger is NOT ctx-bound, so attach the
    // full ctx-merged payload. emit() is a no-op when no provider is registered.
    otelLogger().emit({
      severityNumber: SEVERITY[level],
      severityText: level,
      body: sanitizeString(input.msg),
      attributes: toAttributes(buildLogPayload(ctxFields, input)),
    });
  } catch (err) {
    captureException(err, { feature: 'observability', op: 'shipLog', dropped_msg: input.msg });
  }
}
