import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noStrayConsole from '../../eslint-rules/no-stray-console.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('no-stray-console', () => {
  ruleTester.run('no-stray-console', noStrayConsole, {
    valid: ['logger().info({ event: "ready" });', 'const consoleLike = service.console;'],
    invalid: [
      {
        code: 'console.log("debug");',
        errors: [{ messageId: 'strayConsole' }],
      },
      {
        code: 'console["warn"]("debug");',
        errors: [{ messageId: 'strayConsole' }],
      },
      {
        code: 'globalThis.console.info("debug");',
        errors: [{ messageId: 'strayConsole' }],
      },
      {
        code: 'window.console.error("debug");',
        errors: [{ messageId: 'strayConsole' }],
      },
    ],
  });
});
