// What a member may upload as a skill: no path that climbs out of the skill folder, and nothing
// past the limits Anthropic refuses. Creating, renaming and deleting skills runs on Postgres in
// tests/integration/skill-publishing.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { validateSkillFiles } from '../../src/features/skills/lib/skill-files.ts';
import { skillFilesFromZip } from '../../src/features/skills/lib/zip-intake.ts';

const entry = { path: 'SKILL.md', content: '# Instructions' };
const refused = (run, message) => assert.throws(run, { code: 'TOOL_INPUT_INVALID', message });

test('a skill file path that is absolute, climbs with .., or hides a separator is refused', () => {
  for (const path of ['/root', 'refs/v1..2.md', '../escape', 'a//b', 'a/./b', 'a\\b', 'a\u0000b']) {
    refused(() => validateSkillFiles([entry, { path, content: '' }]), /valid file path/);
  }
  refused(
    () => skillFilesFromZip(zipSync({ 'SKILL.md': strToU8('ok'), '../bad': strToU8('bad') })),
    /valid file path/,
  );
  assert.equal(
    validateSkillFiles([entry, { path: 'scripts/run.py', content: 'print(1)' }]),
    undefined,
  );
});

test('a skill over the file count or size limits, or without a SKILL.md, is refused before upload', () => {
  refused(() => validateSkillFiles([]), /no files/);
  refused(() => validateSkillFiles(Array.from({ length: 41 }, () => entry)), /40 files/);
  refused(() => validateSkillFiles([entry, entry]), /more than once/);
  refused(() => validateSkillFiles([{ ...entry, content: 'x'.repeat(100001) }]), /100 KB/);
  const big = Array.from({ length: 5 }, (_, i) => ({
    path: `${i}.txt`,
    content: 'x'.repeat(100000),
  }));
  refused(() => validateSkillFiles([entry, ...big]), /500 KB/);
  refused(() => validateSkillFiles([{ path: 'notes.md', content: '' }]), /needs a SKILL.md/);
  refused(() => skillFilesFromZip(new Uint8Array(2000001)), /2 MB/);
  refused(() => skillFilesFromZip(zipSync({ 'SKILL.md': new Uint8Array([255]) })), /UTF-8/);
});

test('a zipped skill folder uploads as its files, without the folder name or OS metadata', () => {
  const zip = zipSync({
    'my-skill/SKILL.md': strToU8('# Hello'),
    '__MACOSX/._file': strToU8('junk'),
    'my-skill/docs/help.md': strToU8('Help'),
  });
  assert.deepEqual(skillFilesFromZip(zip).files, [
    { path: 'SKILL.md', content: '# Hello' },
    { path: 'docs/help.md', content: 'Help' },
  ]);
});
