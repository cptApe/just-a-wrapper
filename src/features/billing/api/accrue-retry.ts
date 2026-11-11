import { AppError, BillingError } from '@/lib/errors';
import { retryWhile } from '@/lib/retry-while';
import 'server-only';

// Idempotent usage keys make retries safe even when the database committed before a connection failed.
export const ACCRUAL_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const;

// Jitter prevents parallel failed accruals retrying in lockstep and colliding again.
const ACCRUAL_RETRY_JITTER_RATIO = 0.25;

const TRANSIENT_DATABASE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '58030', // io_error
  'CONNECTION_CLOSED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
]);

// Neon connection failures can lack SQLSTATE; these messages mean the query never reached Postgres.
const TRANSIENT_MESSAGE_MARKERS = ['SASL', 'Connection terminated'] as const;

// Identifies the usage in the error report: a session, a tool call or a sessionless usage key.
export type AccrualRetryContext = Readonly<Record<string, string | undefined>>;

const CAUSE_CHAIN_MAX_DEPTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorCode(cause: unknown): string | undefined {
  if (!isRecord(cause)) return undefined;
  return typeof cause.code === 'string' ? cause.code : undefined;
}

function errorMessage(cause: unknown): string | undefined {
  if (!isRecord(cause)) return undefined;
  return typeof cause.message === 'string' ? cause.message : undefined;
}

// Neon can reject with a WebSocket ErrorEvent rather than an Error, so code and cause alone miss it.
function isWebSocketErrorEvent(cause: unknown): boolean {
  if (!isRecord(cause)) return false;
  if (typeof cause.constructor === 'function' && cause.constructor.name === 'ErrorEvent')
    return true;
  return cause.type === 'error' && 'error' in cause;
}

function nextCause(cause: unknown): unknown {
  return isRecord(cause) ? cause.cause : undefined;
}

export function isTransientDatabaseError(cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < CAUSE_CHAIN_MAX_DEPTH && current !== undefined; depth += 1) {
    if (current instanceof AppError && current.code === 'DATABASE_UNAVAILABLE') return true;
    const code = errorCode(current);
    if (code && (code.startsWith('08') || TRANSIENT_DATABASE_CODES.has(code))) return true;
    if (isWebSocketErrorEvent(current)) return true;
    const message = errorMessage(current);
    if (message && TRANSIENT_MESSAGE_MARKERS.some((marker) => message.includes(marker))) {
      return true;
    }
    current = nextCause(current);
  }
  return false;
}

export function accrualRetryDelays(): number[] {
  return ACCRUAL_RETRY_DELAYS_MS.map(
    (base) => base + Math.floor(Math.random() * base * ACCRUAL_RETRY_JITTER_RATIO),
  );
}

export async function retryTransientAccrual<T>(
  accrue: () => Promise<T>,
  context: AccrualRetryContext,
): Promise<T> {
  let attemptCount = 0;
  try {
    return await retryWhile(
      () => {
        attemptCount += 1;
        return accrue();
      },
      { isRetryable: isTransientDatabaseError, delays: accrualRetryDelays() },
    );
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new BillingError(
      'UNEXPECTED',
      'Billing accrual failed',
      { ...context, attemptCount },
      { cause },
    );
  }
}
