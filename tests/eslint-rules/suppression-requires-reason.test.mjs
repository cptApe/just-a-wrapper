import { test } from 'node:test';
import { RuleTester } from 'eslint';
import suppressionRequiresReason from '../../eslint-rules/suppression-requires-reason.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('suppression-requires-reason', () => {
  ruleTester.run('suppression-requires-reason', suppressionRequiresReason, {
    valid: [
      '// eslint-disable-next-line no-alert -- browser contract requires alert\nalert("x");',
      '// @ts-expect-error -- fixture intentionally passes invalid input\nconsume(1);',
      '// @ts-ignore -- fixture intentionally exercises the legacy call shape\nconsume(1);',
      '// @ts-nocheck -- generated fixture is validated by its producer\nconsume(1);',
      '// biome-ignore lint/a11y/noAutofocus: focus follows the explicit edit action\nfocus();',
      '// eslint-enable no-alert\nalert("x");',
    ],
    invalid: [
      {
        code: '// eslint-disable-next-line no-alert\nalert("x");',
        errors: [{ messageId: 'missingReason' }],
      },
      {
        code: '// @ts-expect-error\nconsume(1);',
        errors: [{ messageId: 'missingReason' }],
      },
      {
        code: '// @ts-ignore\nconsume(1);',
        errors: [{ messageId: 'missingReason' }],
      },
      {
        code: '// @ts-nocheck\nconsume(1);',
        errors: [{ messageId: 'missingReason' }],
      },
      {
        code: '// biome-ignore lint/a11y/noAutofocus\nfocus();',
        errors: [{ messageId: 'missingReason' }],
      },
    ],
  });
});
