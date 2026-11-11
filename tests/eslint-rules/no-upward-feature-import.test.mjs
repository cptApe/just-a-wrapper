import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import FEATURE_LAYERS from '../../eslint-rules/feature-layers.mjs';
import noUpwardFeatureImport, {
  featurePositions,
} from '../../eslint-rules/no-upward-feature-import.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

const layers = [
  { layer: 'platform', features: ['overlays'] },
  { layer: 'library', features: ['files', 'skills'] },
  { layer: 'runtime', features: ['tasks'] },
];
const options = [{ layers }];
const skillsFile = '/repo/src/features/skills/components/skill-card.tsx';
const filesFile = '/repo/src/features/files/api/load.ts';

test('no-upward-feature-import', () => {
  ruleTester.run('no-upward-feature-import', noUpwardFeatureImport, {
    valid: [
      { code: "import { openOverlay } from '@/features/overlays';", filename: skillsFile, options },
      { code: "import { load } from '@/features/files/api/load';", filename: skillsFile, options },
      { code: "import { x } from '../lib/x';", filename: skillsFile, options },
      { code: "import { cn } from '@/lib/utils';", filename: filesFile, options },
      {
        code: "import { createTask } from '@/features/tasks';",
        filename: '/repo/src/app/app/layout.tsx',
        options,
      },
    ],
    invalid: [
      {
        code: "import { createTask } from '@/features/tasks';",
        filename: skillsFile,
        options,
        errors: [
          {
            messageId: 'upward',
            data: { from: 'skills', fromLayer: 'library', to: 'tasks', toLayer: 'runtime' },
          },
        ],
      },
      {
        code: "import { SkillCard } from '../../skills/components/skill-card';",
        filename: filesFile,
        options,
        errors: [
          { messageId: 'sameLayer', data: { from: 'files', to: 'skills', layer: 'library' } },
        ],
      },
      {
        code: "const tasks = await import('@/features/tasks/api/create-task');",
        filename: filesFile,
        options,
        errors: [{ messageId: 'upward' }],
      },
      {
        code: "import { x } from '@/features/unknown/lib/x';",
        filename: filesFile,
        options,
        errors: [{ messageId: 'unknown', data: { feature: 'unknown' } }],
      },
      {
        code: "import { openOverlay } from '@/features/overlays';",
        filename: '/repo/src/features/newcomer/lib/x.ts',
        options,
        errors: [{ messageId: 'unknown', data: { feature: 'newcomer' } }],
      },
    ],
  });
});

test('every folder under src/features is in eslint-rules/feature-layers.mjs exactly once', () => {
  const folders = readdirSync(new URL('../../src/features/', import.meta.url), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const listed = FEATURE_LAYERS.flatMap(({ features }) => features);
  for (const folder of folders) {
    const count = listed.filter((feature) => feature === folder).length;
    assert.equal(
      count,
      1,
      `src/features/${folder} must appear exactly once in eslint-rules/feature-layers.mjs (found ${count}). Add it to the layer it belongs in.`,
    );
  }
  for (const feature of listed) {
    assert.ok(
      folders.includes(feature),
      `eslint-rules/feature-layers.mjs lists "${feature}", which has no folder under src/features. Remove it.`,
    );
  }
  assert.equal(featurePositions(FEATURE_LAYERS).size, listed.length);
});
