import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOverlayHash, parseOverlayHash } from '../../src/features/overlays/lib/hash.ts';

const TOKENS = ['notifications', 'file', 'app', 'skill', 'skill/new'];

test('an overlay link opens the right overlay, and a bad one opens none instead of crashing', () => {
  for (const [hash, token, id] of [
    ['#notifications', 'notifications', null],
    ['#file/abc-123?in=/Reports', 'file', 'abc-123'],
    ['#skill/new', 'skill/new', null],
    ['#skill/sk_9', 'skill', 'sk_9'],
  ]) {
    const parsed = parseOverlayHash(hash, TOKENS);
    assert.equal(parsed?.token, token, hash);
    assert.equal(parsed?.id, id, hash);
  }
  assert.equal(parseOverlayHash('#file/abc?in=/Reports', TOKENS)?.params.get('in'), '/Reports');
  for (const hash of ['', '#', '#nope', '#file/a/b', '#file//x'])
    assert.equal(parseOverlayHash(hash, TOKENS), null, hash);
  assert.doesNotThrow(() => parseOverlayHash('#file/%E0%A4%A', TOKENS));
});

test('an id with slashes, spaces or symbols survives the round trip through the URL', () => {
  const parsed = parseOverlayHash(buildOverlayHash('file', 'a/b c&d=e+f', { in: '/R' }), TOKENS);
  assert.equal(parsed?.token, 'file');
  assert.equal(parsed?.id, 'a/b c&d=e+f');
  assert.equal(parsed?.params.get('in'), '/R');
});
