// PostHog Logs export — an OTel LoggerProvider emitting OTLP-HTTP straight to
// PostHog (EU). NOT the Vercel Log Drain; we own the export and the flush.
//
// nodejs-runtime only (imports node OTLP exporter). Created once in
// instrumentation.ts register(); the structured-log helper (lib/logger.ts) emits
// through the global provider registered here. forceFlush() runs inside Next's
// after() (serverless freezes before the batch timer fires).
//
// See docs/spec/04-observability.md §11.3.

import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { env } from './env';
import { lazyValue } from './lazy-value';

const SERVICE_NAME = 'just-a-wrapper';

const getProvider = lazyValue((): LoggerProvider | null => {
  if (!env.POSTHOG_PROJECT_KEY) return null;
  const exporter = new OTLPLogExporter({
    // PostHog OTLP logs ingest. `/i/v1/logs` is the Logs product endpoint
    // (NOT `/i/v0/e/`, which is the analytics-event capture endpoint).
    url: `${env.POSTHOG_HOST}/i/v1/logs`,
    headers: { Authorization: `Bearer ${env.POSTHOG_PROJECT_KEY}` },
  });

  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    processors: [new BatchLogRecordProcessor(exporter)],
  });
  logs.setGlobalLoggerProvider(provider);
  return provider;
});

export async function initLoggerProvider(): Promise<LoggerProvider | null> {
  return getProvider();
}

// The OTel logger to emit through. Resolves the global provider — returns a
// no-op logger when none is registered, so callers never branch on config.
export function otelLogger() {
  return logs.getLogger(SERVICE_NAME);
}

// Flush buffered log records — called from flushObservability() inside after().
export async function flushLogs(): Promise<void> {
  const provider = getProvider();
  if (provider) await provider.forceFlush();
}
