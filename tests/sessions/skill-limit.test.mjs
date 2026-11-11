// Skills on a new session: the four document skills always ride along, and the provider's 500 cap fails with a clear error.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSkillSessionResources } from '../../src/features/session-runtime/lib/session-resources.ts';
import { AppError } from '../../src/lib/errors.ts';

const skills = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `skill_${index}`,
    kind: 'custom',
    version: `v${index}`,
  }));
const DOCUMENT_SKILLS = ['pptx', 'xlsx', 'docx', 'pdf'].map((id) => ({
  type: 'anthropic',
  skill_id: id,
}));

test('the document skills are attached exactly once, even when a workspace skill shares a name', () => {
  const resources = buildSkillSessionResources([
    ...skills(1),
    { id: 'pptx', kind: 'custom', version: 'unexpected-version' },
  ]);
  assert.deepEqual(resources.slice(-4), DOCUMENT_SKILLS);
  assert.equal(resources.filter((resource) => resource.skill_id === 'pptx').length, 1);
});

test('496 workspace skills fit, and one more fails with a readable limit error instead of being dropped', () => {
  assert.equal(buildSkillSessionResources(skills(496)).length, 500);
  assert.throws(
    () => buildSkillSessionResources(skills(497)),
    (error) =>
      error instanceof AppError &&
      error.code === 'SKILL_LIMIT_EXCEEDED' &&
      /You can attach up to 496 of your own skills\. 4 are built in\./.test(error.message),
  );
});
