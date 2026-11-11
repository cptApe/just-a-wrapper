import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaRangeResponse, parseByteRange } from '../../src/features/files/lib/byte-range.ts';

test('a seek in audio or video asks for exactly the bytes it needs, and a bad range is refused', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseByteRange('bytes=10-', 10), null);
  assert.equal(parseByteRange('bytes=5-2', 10), null);
  assert.equal(parseByteRange('bytes=0-1,4-5', 10), null);
});

test('a seek gets a partial response the player can resume from', async () => {
  const response = await mediaRangeResponse({
    upstream: new Response(Uint8Array.from([2, 3, 4]), { status: 206 }),
    range: { start: 2, end: 4 },
    size: 6,
    headers: new Headers({ 'accept-ranges': 'bytes', 'content-type': 'audio/mpeg' }),
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-range'), 'bytes 2-4/6');
  assert.equal(response.headers.get('content-length'), '3');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), Uint8Array.from([2, 3, 4]));
});

test('an upstream that ignores the range is refused instead of pulled whole into memory', async () => {
  const upstream = new Response(new Uint8Array(8 * 1024 * 1024));
  await assert.rejects(
    () =>
      mediaRangeResponse({
        upstream,
        range: { start: 0, end: 0 },
        size: 8 * 1024 * 1024,
        headers: new Headers({ 'accept-ranges': 'bytes' }),
      }),
    (error) => error.code === 'EXTERNAL_API_FAILED',
  );
  assert.equal(upstream.bodyUsed, false);
});
