/** What paid tools charge: the vendor's real cost, refused before a paid call the balance cannot
 * cover, never a second paid call. Fetch is replaced at the network edge; the ledger write and
 * the dispatcher accrual run on Postgres in tests/integration/metering-tool-charges.test.ts. */
import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import {
  browserSessionVendorCostCents,
  cappedBrowserSessionEnd,
  stagehandCostDeltaMicros,
  stagehandInferenceVendorCostCents,
} from '../../src/features/billing/lib/browser-session-math.ts';
import * as creditMath from '../../src/features/billing/lib/credit-math.ts';
import * as pricing from '../../src/features/billing/pricing-config.ts';
import * as voiceContract from '../../src/features/voice/lib/voice-contract.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

const exaCaptured = [];
globalThis.__exaRequestCaptured = exaCaptured;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/observability' && context.parentURL?.endsWith('/exa-request.ts')) {
      const source =
        'export const captureException = (error) => globalThis.__exaRequestCaptured.push(error);';
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  },
});

Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost/test',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  AI_GATEWAY_API_KEY: 'test-gateway-key',
});
const { resolveCapabilities } = await import('../../src/lib/capabilities.ts');
const { gatewayCostCents, readGatewayCost } = await import('../../src/lib/media-gateway.ts');
const { generateGatewayVideo } = await import('../../src/features/tools/lib/gateway-video.ts');
const { synthesizeSpeech } = await import('../../src/features/voice/api/synthesize-speech.ts');
const { transcribeAudio } = await import('../../src/features/voice/api/transcribe-audio.ts');
const { resolveMediaCost } = await import('../../src/features/billing/api/resolve-media-cost.ts');
const { callExa } = await import('../../src/features/tools/lib/exa-request.ts');

const require = createRequire(import.meta.url);
const capability = resolveCapabilities({ AI_GATEWAY_API_KEY: 'test-gateway-key' }).media;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  exaCaptured.length = 0;
});

const generationCost = (dollars) => ({
  data: {
    id: 'gen_test',
    total_cost: dollars,
    upstream_inference_cost: 0,
    usage: dollars,
    created_at: '2026-11-07',
    model: 'test',
    is_byok: false,
    provider_name: 'test',
    streamed: false,
    finish_reason: 'stop',
    latency: 1,
    generation_time: 1,
    native_tokens_prompt: 0,
    native_tokens_completion: 0,
    native_tokens_reasoning: 0,
    native_tokens_cached: 0,
    native_tokens_cache_creation: 0,
    billable_web_search_calls: 0,
  },
});
const metadata = { gateway: { generationId: 'gen_test' } };

// ---------- Gateway media: the charge is the vendor's reported cost ----------

test('a media charge is the cost the Gateway reports, and a missing or invalid cost is an error', async () => {
  const meta = { generationId: 'test', model: 'test' };
  assert.equal(gatewayCostCents({ totalCost: 0.0123 }, meta), 1.23);
  assert.equal(gatewayCostCents({ totalCost: 0 }, meta), 0);
  for (const value of [{}, { totalCost: -1 }, { totalCost: '0.5' }, { totalCost: Infinity }]) {
    assert.throws(() => gatewayCostCents(value, meta), { code: 'EXTERNAL_API_FAILED' });
  }
  await assert.rejects(readGatewayCost(capability, null, 'test'), { code: 'EXTERNAL_API_FAILED' });
});

test('the estimate is charged only when the real cost cannot be read', async (context) => {
  context.mock.method(console, 'error', () => {});
  const billing = { generationId: 'gen_test', model: 'openai/gpt-image-2', estimatedCostCents: 15 };
  globalThis.fetch = async () => Response.json(generationCost(0.0123));
  assert.equal(await resolveMediaCost(capability, billing), 1.23);
  globalThis.fetch = async () =>
    Response.json({ error: { message: 'unavailable' } }, { status: 403 });
  assert.equal(await resolveMediaCost(capability, billing), 15);
  assert.equal(await resolveMediaCost(capability, { ...billing, generationId: null }), 15);
});

test('a cost record not ready yet is looked up again, and the paid generation is never rerun', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let lookups = 0;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/generation?'), 'only the cost lookup is retried');
    lookups++;
    if (lookups === 1)
      return Response.json({ error: { message: 'not found', type: 'not_found' } }, { status: 404 });
    return Response.json(generationCost(0.0123));
  };
  const lookup = readGatewayCost(capability, 'gen_test', 'test');
  await new Promise((resolve) => setImmediate(resolve));
  context.mock.timers.tick(2000);
  assert.equal(await lookup, 1.23);
  context.mock.timers.reset();
  assert.equal(lookups, 2);
});

test('a provider refusal is not retried as a second paid request', async () => {
  for (const generate of [
    () => synthesizeSpeech(capability, { voiceId: 'test-voice', text: 'hello' }),
    () =>
      generateGatewayVideo(capability, {
        prompt: 'test',
        duration: 4,
        aspectRatio: '16:9',
        resolution: '1280x720',
      }),
  ]) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      return Response.json(
        { error: { message: 'no access', type: 'invalid_request_error' } },
        { status: 403 },
      );
    };
    await assert.rejects(generate(), { code: 'EXTERNAL_API_FAILED' });
    assert.equal(requests, 1);
  }
});

test('a transcript without a duration fails instead of guessing what to charge', async () => {
  globalThis.fetch = async () => Response.json({ text: 'hello', providerMetadata: metadata });
  await assert.rejects(transcribeAudio(capability, { file: new File(['audio'], 'test.wav') }), {
    code: 'EXTERNAL_API_FAILED',
  });
});

// ---------- Voice: dictation and read-aloud ----------

function voiceHarness({ balance = 39, failAccrual = false } = {}) {
  const steps = [];
  const ledger = [];
  const resolve = (name) => {
    if (name === 'server-only') return {};
    if (name === '@/features/billing/api/spend-gate')
      return {
        assertCanSpend: async ({ credits }) => {
          steps.push(['preflight', credits]);
          if (credits > balance) throw new AppError('CREDITS_EXHAUSTED', 'No credits', {});
        },
      };
    const accrue = async (input) => {
      steps.push(['accrue']);
      if (failAccrual) throw new AppError('UNEXPECTED', 'Ledger unavailable', {});
      ledger.push(input);
      return { memberLimitExceeded: false };
    };
    if (name === '@/features/billing/api/accrue-voice') return { accrueVoiceTranscription: accrue };
    if (name === '@/features/billing/api/accrue-voice-synthesis')
      return { accrueVoiceSynthesis: accrue };
    if (name === '@/features/billing/pricing-config') return pricing;
    if (name === '@/features/billing/lib/credit-math') return creditMath;
    if (name === '@/features/billing/api/resolve-media-cost') return { resolveMediaCost };
    if (name === '@/lib/runtime-capabilities')
      return { capabilities: { media: { kind: 'gateway', apiKey: 'test' } } };
    if (name === '@/lib/observability')
      return { captureException: () => {}, flushObservability: async () => {} };
    if (name === '@/lib/errors') return { AppError };
    if (name === '../lib/voice-contract') return voiceContract;
    if (name === './transcribe-audio') return { transcribeAudio };
    if (name === './synthesize-speech') return { synthesizeSpeech };
    return require(name);
  };
  globalThis.fetch = async (url) => {
    if (String(url).includes('/generation?')) {
      steps.push(['lookup']);
      return Response.json({ error: { message: 'usage unavailable' } }, { status: 403 });
    }
    steps.push(['generate']);
    return Response.json({
      text: ' hello ',
      durationInSeconds: 3,
      audio: Buffer.from('ID3test').toString('base64'),
      providerMetadata: metadata,
    });
  };
  const load = (path) => loadTsx(path, resolve);
  return { steps, ledger, load };
}
const caller = { workspaceId: 'w', organizationId: 'o', userId: 'u' };
const dictate = (h, extra = {}) =>
  h
    .load('src/features/voice/api/transcribe-for-composer.ts')
    .transcribeForComposer({ ...caller, audio: new File(['audio'], 'clip.webm'), ...extra });

test('dictation and read-aloud are charged before the result is handed back', async (context) => {
  context.mock.method(console, 'error', () => {});
  const h = voiceHarness();
  assert.deepEqual(await dictate(h), { text: 'hello' });
  assert.deepEqual(h.steps, [['preflight', 1], ['generate'], ['lookup'], ['accrue']]);
  assert.equal(h.ledger[0].audioSeconds, 3);
  assert.equal(h.ledger[0].vendorCostCents, pricing.transcriptionEstimateCents(3));

  const speaker = voiceHarness();
  const { synthesizeForReadAloud } = speaker.load(
    'src/features/voice/api/synthesize-for-read-aloud.ts',
  );
  const speech = await synthesizeForReadAloud({
    anthropicSessionId: 's',
    userId: 'u',
    workspaceId: 'w',
    text: 'hello',
  });
  assert.equal(await new Response(speech.body).text(), 'ID3test');
  assert.deepEqual(speaker.steps, [['preflight', 1], ['generate'], ['lookup'], ['accrue']]);
  assert.equal(speaker.ledger[0].vendorCostCents, pricing.speechEstimateCents(5));
});

test('dictation with an empty balance is refused before the paid request', async () => {
  const h = voiceHarness({ balance: 0 });
  await assert.rejects(dictate(h), { code: 'CREDITS_EXHAUSTED' });
  assert.deepEqual(h.steps, [['preflight', 1]]);
});

test('a long recording cannot pass the balance check by claiming to be short', async () => {
  // 4 MB holds about 93 minutes at the lowest recorder bitrate: 63 credits, above 39.
  const h = voiceHarness();
  const audio = new File([new Uint8Array(4 * 1024 * 1024)], 'clip.webm');
  await assert.rejects(dictate(h, { audio, durationSeconds: 3 }), { code: 'CREDITS_EXHAUSTED' });
  assert.deepEqual(h.steps, [['preflight', 63]]);
});

test('a transcript whose charge fails to record is not handed back unpaid', async (context) => {
  context.mock.method(console, 'error', () => {});
  const h = voiceHarness({ failAccrual: true });
  await assert.rejects(dictate(h), { message: 'Ledger unavailable' });
  assert.equal(h.ledger.length, 0);
});

// ---------- Exa search and page reads ----------

const exaSchema = z.object({ results: z.array(z.object({ url: z.string() })) });
const exaAnswers = (body, init = { status: 200 }) => {
  globalThis.fetch = async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
};

test('an Exa call charges the cost Exa reports, even when the answer is unusable', async () => {
  exaAnswers({ results: [{ url: 'https://a.example' }], costDollars: { total: 0.005 } });
  const out = await callExa({ endpoint: 'search', apiKey: 'k', body: {}, schema: exaSchema });
  assert.equal(out.vendorCostCents, 0.5);
  assert.equal(exaCaptured.length, 0);

  exaAnswers({ items: [], costDollars: { total: 0.01 } });
  await assert.rejects(
    callExa({ endpoint: 'search', apiKey: 'k', body: {}, schema: exaSchema }),
    (error) => error.cost.vendorCostCents === 1,
  );
});

test('an Exa answer without a cost charges nothing and alerts the operator', async () => {
  exaAnswers({ results: [] });
  const out = await callExa({ endpoint: 'contents', apiKey: 'k', body: {}, schema: exaSchema });
  assert.equal(out.vendorCostCents, 0);
  assert.equal(exaCaptured.length, 1);
});

// ---------- Browserbase browsers ----------

test('browser time is charged by the minute at 12 cents an hour, capped at one hour', () => {
  assert.equal(browserSessionVendorCostCents(3600), 12);
  assert.equal(browserSessionVendorCostCents(1800), 6);
  for (const seconds of [-10, 0, 59, 60]) assert.equal(browserSessionVendorCostCents(seconds), 0.2);
  const startedAt = new Date('2026-08-31T10:00:00.000Z');
  assert.equal(
    cappedBrowserSessionEnd(startedAt, new Date('2026-08-31T12:30:00.000Z')).toISOString(),
    '2026-08-31T11:00:00.000Z',
  );
});

test('browser actions charge only the new model work since the last action', () => {
  assert.equal(
    stagehandInferenceVendorCostCents({
      totalPromptTokens: 1_000_000,
      totalCompletionTokens: 500_000,
      totalReasoningTokens: 500_000,
      totalCachedInputTokens: 1_000_000,
    }),
    610,
  );
  for (const [before, after, charged] of [
    [500_000, 800_000, 300_000],
    [0, 0, 0],
    [0, 200_000, 200_000],
  ]) {
    assert.deepEqual(
      stagehandCostDeltaMicros({
        metricsBeforeMicros: before,
        metricsAfterMicros: after,
        fallbackMicros: 500_000,
      }),
      { vendorCostMicros: charged, estimated: false },
    );
  }
});
