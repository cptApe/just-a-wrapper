import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const srcRoot = new URL('../../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { shortCircuit: true, url: 'data:text/javascript,export%20{}' };
    }
    // The capture sink validates process env at import; the client only needs
    // a callable, so the test records nothing and asserts on the thrown error.
    if (specifier === '@/lib/observability') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export%20function%20captureException()%20{}',
      };
    }
    if (specifier.startsWith('@/')) {
      const relativePath = specifier.slice(2);
      const path = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
      return nextResolve(new URL(path, srcRoot).href, context);
    }
    if (
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(srcRoot.href) &&
      !specifier.endsWith('.ts')
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  getBrowserbaseDebugUrl,
  getBrowserbaseSession,
  isBrowserbaseSessionGone,
  isBrowserbaseSessionLive,
  isBrowserbaseSessionMissing,
  releaseBrowserbaseSession,
} = await import('../../src/features/tools/api/browserbase-client.ts');

// Every body below is a VERBATIM live capture from api.browserbase.com (the
// provider responses), with only the session
// credentials replaced by placeholders: connectUrl / signingKey / the live-view
// `t=` token. The schemas never read those fields, so the placeholders cannot
// mask a real shape mismatch.

// GET /v1/sessions/{id} of a session released after ~1s. The timestamps carry a
// numeric UTC offset and sub-second (createdAt: microsecond) precision.
const LIVE_COMPLETED_SESSION = {
  id: '0a756090-43b2-44a8-8e5f-810d2e8cd22d',
  createdAt: '2026-09-01T09:33:21.886731+00:00',
  updatedAt: '2026-09-01T09:33:22.159+00:00',
  projectId: '5d7378d0-9ee3-4ba5-b38a-65c47a5889fe',
  status: 'COMPLETED',
  proxyBytes: 0,
  keepAlive: true,
  region: 'us-west-2',
  startedAt: '2026-09-01T09:33:21.876+00:00',
  endedAt: '2026-09-01T09:33:22.159+00:00',
  expiresAt: '2026-09-01T10:33:21.876+00:00',
  contextId: 'b313e911-b8bf-45d8-af4b-bde2459e5c29',
};

// POST /v1/sessions → 201 with the app's exact create params. No endedAt (the
// docs list it as required on this response; the wire omits it) and the three
// connection credentials the app never reads.
const LIVE_CREATED_SESSION = {
  id: '3c6dd488-8a90-4c45-bbea-80117387c6d3',
  createdAt: '2026-09-01T11:12:00.469866+00:00',
  updatedAt: '2026-09-01T11:12:00.469866+00:00',
  projectId: '5d7378d0-9ee3-4ba5-b38a-65c47a5889fe',
  status: 'RUNNING',
  proxyBytes: 0,
  keepAlive: true,
  region: 'us-west-2',
  startedAt: '2026-09-01T11:12:00.468+00:00',
  expiresAt: '2026-09-01T12:12:00.468+00:00',
  connectUrl: 'wss://connect.usw2.browserbase.com/?signingKey=PLACEHOLDER',
  seleniumRemoteUrl: 'http://connect.usw2.browserbase.com/webdriver',
  signingKey: 'PLACEHOLDER',
};

// GET /v1/sessions/{id} of a Stagehand-created session mid-run: contextId and
// Stagehand's own userMetadata tag are present, endedAt absent.
const LIVE_RUNNING_STAGEHAND_SESSION = {
  id: '013dd9ae-145a-4914-afb6-01664646cb43',
  createdAt: '2026-09-01T11:17:29.62031+00:00',
  updatedAt: '2026-09-01T11:17:29.62031+00:00',
  projectId: '5d7378d0-9ee3-4ba5-b38a-65c47a5889fe',
  status: 'RUNNING',
  proxyBytes: 0,
  keepAlive: true,
  region: 'us-west-2',
  startedAt: '2026-09-01T11:17:29.617+00:00',
  expiresAt: '2026-09-01T12:17:29.617+00:00',
  contextId: '8862200f-74d7-41bc-b488-f1d103327fdb',
  userMetadata: { stagehand: 'true' },
  connectUrl: 'wss://connect.usw2.browserbase.com/?signingKey=PLACEHOLDER',
  seleniumRemoteUrl: 'http://connect.usw2.browserbase.com/webdriver',
  signingKey: 'PLACEHOLDER',
};

// Browserbase's error envelope, live variants.
const LIVE_404 = { statusCode: 404, error: 'Not Found', message: 'Not Found' };
const LIVE_410 = { statusCode: 410, error: 'Gone', message: 'Session stopped' };

function withResponse(spec, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body });
    if (spec.throws) throw spec.throws;
    const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
    return new Response(spec.status === 204 ? null : body, {
      status: spec.status ?? 200,
      headers: {
        ...(spec.status === 204 ? {} : { 'content-type': 'application/json' }),
        ...(spec.headers ?? {}),
      },
    });
  };
  return run(calls).finally(() => {
    globalThis.fetch = original;
  });
}

test('every live session shape parses, and only a pending or running session counts as live', async () => {
  for (const body of [
    LIVE_COMPLETED_SESSION,
    LIVE_CREATED_SESSION,
    LIVE_RUNNING_STAGEHAND_SESSION,
  ]) {
    await withResponse({ body }, async () => {
      const session = await getBrowserbaseSession('test-key', body.id);
      assert.equal(session.startedAt, body.startedAt);
      assert.equal(session.endedAt, body.endedAt);
      assert.equal('signingKey' in session, false, 'connection credentials are never kept');
    });
  }
  for (const status of ['PENDING', 'RUNNING', 'ERROR', 'TIMED_OUT', 'COMPLETED']) {
    await withResponse({ body: { ...LIVE_COMPLETED_SESSION, status } }, async () => {
      const session = await getBrowserbaseSession('test-key', LIVE_COMPLETED_SESSION.id);
      assert.equal(isBrowserbaseSessionLive(session), status === 'PENDING' || status === 'RUNNING');
    });
  }
});

test('releasing a browser asks Browserbase to stop it and returns when it ended', async () => {
  const released = { ...LIVE_COMPLETED_SESSION, keepAlive: false };
  await withResponse({ body: released }, async (calls) => {
    const echoed = await releaseBrowserbaseSession('test-key', 'proj', released.id);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body), { status: 'REQUEST_RELEASE', projectId: 'proj' });
    assert.equal(echoed.endedAt, LIVE_COMPLETED_SESSION.endedAt);
  });
});

test('a browser Browserbase no longer has reads as missing or stopped, not as a failure to retry', async () => {
  await withResponse({ body: LIVE_404, status: 404 }, async () => {
    await assert.rejects(releaseBrowserbaseSession('test-key', 'proj', 'gone'), (error) => {
      assert.equal(isBrowserbaseSessionMissing(error), true);
      assert.equal(isBrowserbaseSessionGone(error), false);
      return true;
    });
  });
  await withResponse({ body: LIVE_410, status: 410 }, async () => {
    await assert.rejects(getBrowserbaseDebugUrl('test-key', 'abc'), (error) =>
      isBrowserbaseSessionGone(error),
    );
  });
});

test('an error shown in the chat never carries a signing key or live-view token', async () => {
  const leaky = {
    statusCode: 400,
    message: 'rejected wss://connect.usw2.browserbase.com/?signingKey=SECRETKEY and ?t=SECRETTOKEN',
  };
  await withResponse({ body: leaky, status: 400 }, async () => {
    await assert.rejects(getBrowserbaseSession('test-key', 'x'), (error) => {
      assert.doesNotMatch(error.context.chatDetail, /SECRETKEY|SECRETTOKEN/);
      return true;
    });
  });
});
