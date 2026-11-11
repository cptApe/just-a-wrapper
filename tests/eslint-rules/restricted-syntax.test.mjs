import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import {
  FLOATING_PANEL_TRANSITION,
  INTEGRATION_MOCKS,
  INTEGRATION_SEAMS,
  NO_UPGRADE_PAGE,
  RAW_API_FETCH,
  RAW_POSTHOG_CAPTURE,
  RETIRED_TOOLS_FACETS,
  SOURCE_TEXT_IN_TESTS,
} from '../../eslint-rules/restricted-syntax.mjs';

const linter = new Linter();

function count(entries, code) {
  return linter.verify(
    code,
    {
      files: ['**/*.tsx'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      rules: { 'no-restricted-syntax': ['error', ...entries] },
    },
    { filename: 'sample.tsx' },
  ).length;
}

test('raw JSON fetches of /api are refused; other fetches pass', () => {
  assert.equal(count(RAW_API_FETCH, "fetch('/api/files');"), 1);
  assert.equal(count(RAW_API_FETCH, 'fetch(`/api/files/${id}`);'), 1);
  assert.equal(count(RAW_API_FETCH, "fetch('https://example.com/api/');"), 0);
});

test('raw posthog.capture is refused; captureException passes', () => {
  assert.equal(count(RAW_POSTHOG_CAPTURE, "posthog.capture('x');"), 1);
  assert.equal(count(RAW_POSTHOG_CAPTURE, 'posthog.captureException(error);'), 0);
});

test('a floating panel may not carry a duration-* transition', () => {
  for (const component of ['DropdownMenu', 'Popover', 'Select', 'Tooltip']) {
    const panel = (classes) =>
      `export const ${component}Content = React.forwardRef(() => <div className={cn('${classes}')} />);`;
    assert.equal(count(FLOATING_PANEL_TRANSITION, panel('p-1 duration-150')), 1, component);
    assert.equal(count(FLOATING_PANEL_TRANSITION, panel('animation-duration-150 p-1')), 0);
  }
  assert.equal(
    count(FLOATING_PANEL_TRANSITION, 'function PopoverContent() { return `p-1 duration-200`; }'),
    1,
  );
  // Triggers and other components may still transition.
  assert.equal(
    count(FLOATING_PANEL_TRANSITION, "export const SelectTrigger = () => 'duration-150';"),
    0,
  );
});

test('the upgrade page cannot come back; plans are chosen in the plan dialog', () => {
  for (const code of [
    "const href = '/upgrade';",
    'const href = `/upgrade?from=${source}`;',
    'const node = <a href="/upgrade">Upgrade</a>;',
    "const label = 'Get the repo';",
  ]) {
    assert.equal(count(NO_UPGRADE_PAGE, code), 1, code);
  }
  for (const code of [
    "const href = '/upgraded-things';",
    "const href = '/api/upgrade-check';",
    "const href = 'docs/upgrade';",
    "const label = 'Upgrade storage';",
    'const node = <Button>See plans</Button>;',
    'const node = <ModalTitle>Choose a plan</ModalTitle>;',
  ]) {
    assert.equal(count(NO_UPGRADE_PAGE, code), 0, code);
  }
});

test('the Tools page cannot read the retired source or permission facet', () => {
  assert.equal(count(RETIRED_TOOLS_FACETS, "useQueryState('perm');"), 1);
  assert.equal(count(RETIRED_TOOLS_FACETS, "useQueryState('source', parser);"), 1);
  assert.equal(count(RETIRED_TOOLS_FACETS, "useQueryState('status', toolsParsers.status);"), 0);
});

test('a test may not read a src/ file as text', () => {
  for (const code of [
    "readFileSync('src/components/ui/button.tsx', 'utf8');",
    "fs.readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');",
    "await readFile(path.join(ROOT, 'src/lib/env.ts'), 'utf8');",
    'readdirSync(`src/features/${name}`);',
  ]) {
    assert.equal(count(SOURCE_TEXT_IN_TESTS, code), 1, code);
  }
  for (const code of [
    "readFileSync(new URL('./fixtures/events.json', import.meta.url), 'utf8');",
    "readFileSync('.vercelignore', 'utf8');",
    "loadTsx('src/components/ui/button.tsx', require);",
    "await readFile(path.join('src/db/migrations', name), 'utf8');",
  ]) {
    assert.equal(count(SOURCE_TEXT_IN_TESTS, code), 0, code);
  }
});

test('an integration test mocks only the listed seams and never the database', () => {
  for (const code of [
    "vi.mock('@/db', () => ({ db: fake }));",
    "vi.mock('@/features/billing/api/spend-gate', () => ({}));",
    "vi.doMock('@/lib/caller', () => ({}));",
    "vi.mock('@/features/agents/api/anthropic-client-v2', () => ({}));",
  ]) {
    assert.equal(count(INTEGRATION_MOCKS, code), 1, code);
  }
  for (const seam of INTEGRATION_SEAMS) {
    assert.equal(count(INTEGRATION_MOCKS, `vi.mock('${seam}', () => ({}));`), 0, seam);
  }
  assert.equal(count(INTEGRATION_MOCKS, "vi.mock('resend', () => ({}));"), 0);
  assert.equal(count(INTEGRATION_MOCKS, "vi.mock('next/headers', () => ({}));"), 0);
});
