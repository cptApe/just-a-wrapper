import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRESET_SKILLS } from '../../src/features/skills/constants.ts';

// Anthropic refuses a skill upload whose directory does not match its SKILL.md name, so a
// mismatch here leaves every new workspace without its preset skills.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// How Anthropic derives the upload directory from a skill's name.
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

test('every preset skill ships a SKILL.md whose name matches its upload directory', () => {
  for (const preset of PRESET_SKILLS) {
    const skillMd = path.join(repoRoot, preset.contentDir, 'SKILL.md');
    assert.ok(existsSync(skillMd), `${preset.name}: ${preset.contentDir}/SKILL.md is missing`);
    const frontmatter = readFileSync(skillMd, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontmatter, `${preset.name}: SKILL.md has no frontmatter`);
    const nameLine = frontmatter[1].split(/\r?\n/).find((line) => line.startsWith('name:'));
    assert.equal(nameLine?.slice('name:'.length).trim(), preset.name, preset.contentDir);
    assert.equal(preset.directory, slugify(preset.name), preset.name);
  }
  assert.ok(
    existsSync(path.join(repoRoot, 'content/app-guide/app-guide.md')),
    'the App Guide ships the guide that search reads',
  );
});
