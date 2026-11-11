import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTraceId, parseTraceparent } from '../../src/lib/trace.ts';

// The log export and OTel collectors reject anything but a W3C 32-hex trace id.
const HEX32 = /^[0-9a-f]{32}$/;

test('trace ids are W3C ids, and a malformed traceparent header is ignored', () => {
  const id = newTraceId();
  assert.match(id, HEX32);
  assert.notEqual(id, newTraceId());
  assert.equal(parseTraceparent(`00-${id}-${'a'.repeat(16)}-01`), id);
  for (const header of [
    null,
    '',
    'garbage',
    `00-${'z'.repeat(32)}-${'a'.repeat(16)}-01`,
    `00-${'0'.repeat(32)}-${'a'.repeat(16)}-01`,
    '00-123e4567e89b12d3a456426614174000-a-01',
  ])
    assert.equal(parseTraceparent(header), undefined, String(header));
});
