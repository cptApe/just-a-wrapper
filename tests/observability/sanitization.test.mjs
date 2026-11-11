// Unit regressions: real logger/serializer/capture pipeline; only transport SDKs
// are stubbed. Nothing is sent to PostHog, Resend.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const captures = [];
const exports = [];
const browserCaptures = [];
const env = { POSTHOG_PROJECT_KEY: 'test', NEXT_PUBLIC_POSTHOG_KEY: 'test', LOG_LEVEL: 'info' };
globalThis.__redaction = { captures, browserCaptures, exports, env, failEmail: false };
const stub = (body) => ({
  url: `data:text/javascript,${encodeURIComponent(body)}`,
  shortCircuit: true,
});
registerHooks({
  resolve(specifier, context, next) {
    if (/^(\.\/env(?:\.ts)?|@\/lib\/env)$/.test(specifier))
      return stub('export const env = globalThis.__redaction.env');
    if (specifier === 'posthog-js')
      return stub(`export default {
      captureException(...args) { globalThis.__redaction.browserCaptures.push(args); }
    }`);
    if (specifier === 'posthog-node')
      return stub(`export class PostHog {
      captureException(...args) { globalThis.__redaction.captures.push(args); }
    }`);
    if (/otel-logs(?:\.ts)?$/.test(specifier))
      return stub(`
      export const otelLogger = () => ({ emit: (v) => globalThis.__redaction.exports.push(v) });
      export const flushLogs = async () => {};
    `);
    if (specifier === '@/lib/runtime-capabilities')
      return stub("export const capabilities = { email: { kind: 'resend', apiKey: 'test' } }");
    if (specifier === 'resend')
      return stub(
        "export class Resend { emails = { send: async () => globalThis.__redaction.failEmail ? ({ data: null, error: { message: 'provider rejected' } }) : ({ data: { id: 'mail_1' }, error: null }) }; }",
      );
    return next(specifier, context);
  },
});
const { DrizzleQueryError } = await import('drizzle-orm/errors');
const { logBetterAuth, logger } = await import('../../src/lib/logger.ts');
const { shipLog } = await import('../../src/lib/logger.ts');
const { AppError, serializeError } = await import('../../src/lib/errors.ts');
const { captureException } = await import('../../src/lib/observability.ts');
const { captureException: captureBrowserException } = await import(
  '../../src/lib/observability-client.ts'
);
const { sanitize } = await import('../../src/lib/sanitize.ts');
const { sendTransactionalEmail } = await import(
  '../../src/features/notifications/api/send-transactional-email.ts'
);
const email = 'private.person@example.test';
const secretUrl = 'https://example.test/reset?token=private-token-123';
const nested = {
  one: { two: { three: { email, url: secretUrl, otp: '987654', inviteLink: secretUrl } } },
};
function safe(value) {
  const output = JSON.stringify(value);
  for (const secret of [email, secretUrl, 'private-token-123', '987654'])
    assert.ok(!output.includes(secret), output);
}
function stdout(run) {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (line) => {
    lines.push(String(line));
    return true;
  };
  try {
    run();
  } finally {
    process.stdout.write = original;
  }
  assert.ok(lines.length);
  return lines.map((line) => JSON.parse(line));
}

test('logger removes nested secrets, child bindings, and formatted message values', () => {
  const lines = stdout(() =>
    logger().child(nested).info(nested, 'recipient %s link %s', email, secretUrl),
  );
  safe(lines);
  assert.equal(lines[0].one.two.three.email, '[Redacted]');
});

test('error serialization removes nested context, message, stack and cyclic causes', () => {
  const error = new AppError('UNEXPECTED', `Failed ${email} ${secretUrl}`, nested);
  error.cause = error;
  const result = serializeError(error);
  safe(result);
  assert.equal(result.code, 'UNEXPECTED');
  assert.equal(result.cause, '[Redacted]');
  assert.equal(error.context.one.two.three.email, email);
});

test('a captured error reaches PostHog and the console without secrets', () => {
  const original = console.error;
  const consoleLines = [];
  console.error = (...args) => consoleLines.push(args);
  const error = new AppError('UNEXPECTED', `Failed ${email}`, nested, {
    cause: new Error(secretUrl),
  });
  try {
    captureException(error, nested);
  } finally {
    console.error = original;
  }
  const [captured, , props] = captures.at(-1);
  assert.ok(captured instanceof Error);
  assert.ok(captured.cause instanceof Error);
  safe({
    ...captured,
    message: captured.message,
    stack: captured.stack,
    cause: serializeError(captured.cause),
    props,
  });
  safe(consoleLines);
  assert.notEqual(captured, error);
});

const boundToken = 'bound-session-value-123';
const failedQuery = () =>
  new DrizzleQueryError(
    'select "id" from "auth_session" where "auth_session"."token" = $1',
    [boundToken, `first line\nsecond line ${boundToken}`],
    new Error('websocket closed'),
  );

function withoutConsole(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test('error serialization removes query params from message, stack, params and causes', () => {
  const wrapped = new AppError('UNEXPECTED', 'Session read failed', {}, { cause: failedQuery() });
  const result = serializeError(wrapped);
  assert.ok(!JSON.stringify(result).includes(boundToken));
  assert.ok(!JSON.stringify(result).includes('second line'));
  assert.equal(result.cause.params, '[Redacted]');
  assert.match(result.cause.message, /^Failed query: select "id"/);
  assert.match(result.cause.stack, /\n\s+at /);
});

test('server capture keeps query params out of the SDK Error and console', () => {
  const consoleLines = withoutConsole(() => captureException(failedQuery(), { op: 'read' }));
  const [captured] = captures.at(-1);
  assert.ok(!JSON.stringify(consoleLines).includes(boundToken));
  assert.ok(!`${captured.message}${captured.stack}${String(captured.params)}`.includes(boundToken));
});

test('browser capture keeps query params out and preserves non-V8 stack frames', () => {
  const error = failedQuery();
  const frame = 'loadPage@https://app.example.test/_next/static/chunks/page.js:1:20';
  error.stack = frame;
  const consoleLines = withoutConsole(() =>
    captureBrowserException(error, { boundary: 'test', params: [boundToken] }),
  );
  const [captured, properties] = browserCaptures.at(-1);
  assert.notEqual(captured, error);
  assert.equal(captured.stack, frame);
  assert.ok(!`${captured.message}${String(captured.params)}`.includes(boundToken));
  assert.ok(!JSON.stringify(properties).includes(boundToken));
  assert.ok(!JSON.stringify(consoleLines).includes(boundToken));
});

test('Better Auth log sink redacts query params in its message and details', () => {
  const error = failedQuery();
  const lines = stdout(() => logBetterAuth('error', error.message, 'INTERNAL_SERVER_ERROR', error));
  assert.ok(!JSON.stringify(lines).includes(boundToken));
  assert.match(lines[0].msg, /^Failed query: select "id"/);
  assert.equal(lines[0].details[1].params, '[Redacted]');
});

test('shipped OTLP logs carry no secrets in body or attributes', () => {
  safe(stdout(() => shipLog({ msg: `Failed ${email} ${secretUrl}`, ...nested })));
  safe(exports.at(-1));
  assert.equal(exports.at(-1).severityText, 'info');
});

test('an email send logs and fails with a recipient hash, never the address', async () => {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (line) => {
    lines.push(String(line));
    return true;
  };
  try {
    await sendTransactionalEmail({
      to: email,
      purpose: 'sign-in-code',
      email: { subject: 'test', text: '', html: '', parts: { lines: [] } },
    });
  } finally {
    process.stdout.write = original;
  }
  assert.equal(lines.length, 1);
  assert.ok(!lines.join('').includes('@'));
  assert.match(JSON.parse(lines[0]).recipientHash, /^[a-f0-9]{64}$/);

  globalThis.__redaction.failEmail = true;
  try {
    await assert.rejects(
      sendTransactionalEmail({
        to: email,
        purpose: 'invitation',
        email: { subject: 'Invitation', html: '', text: '' },
      }),
      (error) => {
        assert.equal(error.code, 'EXTERNAL_API_FAILED');
        assert.match(error.context.recipientHash, /^[a-f0-9]{64}$/);
        assert.ok(!JSON.stringify(error.context).includes(email));
        return true;
      },
    );
  } finally {
    globalThis.__redaction.failEmail = false;
  }
});

test('the sanitizer bounds huge, deep and wide input and never runs getters', () => {
  const input = { values: Array(10000).fill(nested), text: 'a'.repeat(10000) };
  Object.defineProperty(input, 'getter', {
    enumerable: true,
    get: () => assert.fail('getter invoked'),
  });
  const result = sanitize(input);
  assert.ok(JSON.stringify(result).length < 20000);
  assert.equal(result.text, '[Redacted]');
  assert.equal(result.getter, '[Redacted]');
  assert.equal(result.values.length, 65);
  safe(result);
  let deep = nested;
  for (let i = 0; i < 30; i++) deep = { child: deep };
  const wide = Array.from({ length: 64 }, () =>
    Array.from({ length: 64 }, () => ({ detail: 'x'.repeat(100) })),
  );
  assert.ok(JSON.stringify(sanitize(deep)).length < 200);
  assert.ok(JSON.stringify(sanitize(wide)).length < 40000);
});

test('the sanitizer removes credentials in free text, keys, arrays and URLs', () => {
  const result = sanitize({
    [email]: [secretUrl, new URL(secretUrl)],
    detail: 'Authorization: Bearer opaqueCredential123456 token=anotherCredential',
    nested: { access_token: 'opaqueCredential123456', API_KEY: 'anotherCredential' },
  });
  safe(result);
  assert.doesNotMatch(JSON.stringify(result), /opaqueCredential|anotherCredential/);
  assert.equal(
    sanitize('https://u:p@example.test/x https://example.test/?code=1 https://example.test/#t=1'),
    '[Redacted] [Redacted] [Redacted]',
  );
});
