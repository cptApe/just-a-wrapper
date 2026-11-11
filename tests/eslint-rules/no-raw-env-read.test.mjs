import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noRawEnvRead from '../../eslint-rules/no-raw-env-read.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('no-raw-env-read', () => {
  ruleTester.run('no-raw-env-read', noRawEnvRead, {
    valid: [
      { code: 'const mode = process.env.NODE_ENV;', options: [{ allow: ['NODE_ENV'] }] },
      'const key = env.STRIPE_SECRET_KEY;',
      // A computed read is how env.ts reports presence by name; the schema owns those keys.
      'const raw = process.env[name];',
      'const other = config.env.STRIPE_SECRET_KEY;',
    ],
    invalid: [
      {
        code: 'const key = process.env.STRIPE_SECRET_KEY;',
        options: [{ allow: ['NODE_ENV'] }],
        errors: [{ messageId: 'rawEnvRead', data: { name: 'STRIPE_SECRET_KEY' } }],
      },
      {
        code: 'if (process.env.NEXT_PUBLIC_E2E === "1") run();',
        errors: [{ messageId: 'rawEnvRead' }],
      },
    ],
  });
});
