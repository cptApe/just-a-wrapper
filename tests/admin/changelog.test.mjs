// The console's update badge: a fork is told it is behind only when the kit really is ahead, and
// an unreadable version never throws on the admin pages that ask.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  canReadVersion,
  isReleaseNewerThanFork,
  KIT_CHANGELOG,
  KIT_VERSION,
  upstreamAhead,
} from '../../content/changelog.ts';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

test('the newest changelog entry, KIT_VERSION and package.json agree, newest first', () => {
  assert.equal(KIT_VERSION, KIT_CHANGELOG[0].version);
  assert.equal(manifest.version, KIT_VERSION);
  for (let index = 1; index < KIT_CHANGELOG.length; index += 1) {
    const [newer, older] = [KIT_CHANGELOG[index - 1], KIT_CHANGELOG[index]];
    assert.ok(
      upstreamAhead(older.version, newer.version),
      `${newer.version} above ${older.version}`,
    );
    assert.ok(newer.date >= older.date);
    assert.equal(isReleaseNewerThanFork(newer, older.version), true);
  }
});

test('a fork is behind only below the kit, comparing segments as numbers', () => {
  const [major, minor, patch] = KIT_VERSION.split('.').map(Number);
  assert.equal(upstreamAhead(KIT_VERSION), false);
  assert.equal(upstreamAhead('0.0.0'), true);
  assert.equal(upstreamAhead(`${major}.${minor}.${patch + 1}`), false);
  assert.equal(upstreamAhead(`${major + 1}.0.0`), false);
  assert.equal(upstreamAhead('0.9.0', '0.10.0'), true);
  assert.equal(upstreamAhead('0.10.0', '0.9.0'), false);
});

test('a version that cannot be parsed answers false and never throws', () => {
  for (const version of ['0.5', 'v0.5.0', '', '0.6.0-rc.1', '1.0.0+build.5', 'main']) {
    assert.equal(canReadVersion(version), false, version);
    assert.equal(upstreamAhead(version), false, version);
    assert.equal(upstreamAhead('0.0.0', version), false, version);
  }
});
