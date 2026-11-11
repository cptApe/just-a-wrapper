// Pure transition tables and reducers reject terminal moves and stale async completions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reduceDraft } from '../../src/features/memory/lib/draft-machine.ts';
import { skillMachine } from '../../src/features/skills/lib/skill-machine.ts';
import { reduceUpload } from '../../src/features/skills/lib/upload-machine.ts';

test('a deleting skill can never be published or revived', () => {
  const allowed = {
    ready: ['publishing', 'deleting'],
    publishing: ['ready', 'deleting'],
    deleting: [],
  };
  for (const from of skillMachine.states)
    for (const to of skillMachine.states) {
      const expected = allowed[from].includes(to);
      assert.equal(skillMachine.can(from, to), expected, `${from} -> ${to}`);
      assert.equal(skillMachine.sourcesOf(to).includes(from), expected);
      if (expected) assert.doesNotThrow(() => skillMachine.assertCan(from, to));
      else assert.throws(() => skillMachine.assertCan(from, to), { code: 'CONFLICT' });
    }
});

test('a note save in flight cannot be cancelled, edited or finished by a stale reply', () => {
  const editing = { kind: 'editing', draft: 'mine', baseContentSha256: 'base' };
  const saving = reduceDraft(editing, { type: 'save', attempt: 'current' });
  for (const event of [
    { type: 'cancel' },
    { type: 'edit', draft: 'new', baseContentSha256: 'new' },
    { type: 'saved', attempt: 'stale' },
  ]) {
    assert.strictEqual(reduceDraft(saving, event), saving);
  }
  assert.deepEqual(reduceDraft(saving, { type: 'saved', attempt: 'current' }), { kind: 'read' });
});

test('a conflicted note draft cannot overwrite the newer note until a reload succeeds', () => {
  const saving = { kind: 'saving', draft: 'mine', baseContentSha256: 'base', attempt: 'save' };
  const conflict = reduceDraft(saving, { type: 'conflict', attempt: 'save' });
  assert.strictEqual(reduceDraft(conflict, { type: 'save', attempt: 'retry' }), conflict);
  const reloading = reduceDraft(conflict, { type: 'reload', attempt: 'reload' });
  assert.deepEqual(reduceDraft(reloading, { type: 'reloadFailed', attempt: 'reload' }), conflict);
  assert.deepEqual(reduceDraft(reloading, { type: 'reloaded', attempt: 'reload' }), {
    kind: 'read',
  });
});

test('a skill upload never shows the previous file and cannot be closed while saving', () => {
  const reading = reduceUpload({ kind: 'closed' }, { type: 'read', attempt: 'new' });
  const review = { files: [{ path: 'SKILL.md', content: 'skill' }], name: 'Name', description: '' };
  assert.strictEqual(reduceUpload(reading, { type: 'loaded', attempt: 'old', review }), reading);
  const ready = reduceUpload(reading, { type: 'loaded', attempt: 'new', review });
  const saving = reduceUpload(ready, { type: 'save', attempt: 'save' });
  assert.strictEqual(reduceUpload(saving, { type: 'close' }), saving);
  assert.strictEqual(reduceUpload(saving, { type: 'saved', attempt: 'old' }), saving);
  assert.deepEqual(reduceUpload(saving, { type: 'failed', attempt: 'save' }), ready);
});
