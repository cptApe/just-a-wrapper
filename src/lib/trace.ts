// W3C Trace Context helpers. Kept dependency-free (no errors.ts / env import) so
// it loads under strip-only `node --test` and is unit-testable in isolation.
//
// The `trace_id` is the ONLY cross-system correlation key in this stack (no APM
// provider) — it must be a real W3C trace-id (32 lowercase hex), NOT a
// randomUUID, or the OTLP log export and any downstream OTel collector won't
// recognize it. See docs/spec/04-observability.md §5.

import { randomBytes } from 'node:crypto';

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const PARENT_ID_RE = /^[0-9a-f]{16}$/;

// 16 random bytes → 32 lowercase hex. A valid W3C trace-id (must not be all-zero).
export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

// Extract the trace-id from an inbound `traceparent` header. Returns undefined
// when the header is missing or malformed, so the caller mints a fresh one.
export function parseTraceparent(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const parts = header.trim().split('-');
  // version-traceid-parentid-flags
  if (parts.length !== 4) return undefined;
  const version = parts.at(0);
  const traceId = parts.at(1);
  const parentId = parts.at(2);
  if (version !== '00' || traceId === undefined || parentId === undefined) return undefined;
  if (!TRACE_ID_RE.test(traceId) || traceId === '0'.repeat(32)) return undefined;
  if (!PARENT_ID_RE.test(parentId) || parentId === '0'.repeat(16)) return undefined;
  return traceId;
}
