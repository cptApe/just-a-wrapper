import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendMemoryFileListing,
  STORE_INSTRUCTIONS_MAX_CHARS,
  USER_STORE_INSTRUCTIONS,
} from '../../src/features/memory/lib/memory.ts';

// The listing appended at session create must never push instructions past the sessions API's
// cap, or the session fails to start.

test('a store whose paths all fit lists every path', () => {
  const out = appendMemoryFileListing(USER_STORE_INSTRUCTIONS, ['/about-user.md', '/roadmap/a.md']);
  assert.equal(
    out,
    `${USER_STORE_INSTRUCTIONS} Files in this store as of session start: /about-user.md, /roadmap/a.md.`,
  );
});

test('a large store truncates its listing under the cap and counts every path it left out', () => {
  const paths = Array.from({ length: 400 }, (_, i) => `/notes/long-file-name-${i}.md`);
  const out = appendMemoryFileListing(USER_STORE_INSTRUCTIONS, paths);
  assert.ok(out.length <= STORE_INSTRUCTIONS_MAX_CHARS);
  const remaining = Number(out.match(/…and (\d+) more\./)?.[1]);
  const included = (out.match(/\/notes\/long-file-name-\d+\.md/g) ?? []).length;
  assert.ok(remaining > 0);
  assert.equal(included + remaining, 400);
  const nearCap = 'x'.repeat(STORE_INSTRUCTIONS_MAX_CHARS - 10);
  assert.equal(appendMemoryFileListing(nearCap, ['/about-user.md']), nearCap);
  assert.equal(appendMemoryFileListing(nearCap, []), nearCap);
});
