import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noBareErrorThrow from '../../eslint-rules/no-bare-error-throw.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
});

test('no-bare-error-throw', () => {
  ruleTester.run('no-bare-error-throw', noBareErrorThrow, {
    valid: [
      // AppError subclasses are the sanctioned throw.
      "throw new AppError('UNEXPECTED', 'x');",
      "throw new ToolError('TOOL_HANDLER_FAILED', 'x', { a: 1 });",
      "throw new IntegrationError('EXTERNAL_API_FAILED', 'x', {}, { cause: e });",
      "throw new BillingError('CREDITS_EXHAUSTED', 'x');",
      // Rethrowing an existing value is fine.
      'throw err;',
      // Throwing a non-Error value the rule doesn't police (not a NewExpression).
      "throw 'boom';",
      // A member-expression constructor (e.g. lib.Error) is not the bare built-in.
      "throw new foo.Error('x');",
      // Constructing an Error without throwing it is allowed (e.g. `cause`).
      "const e = new Error('x'); throw new ToolError('UNEXPECTED', 'y', {}, { cause: e });",
    ],
    invalid: [
      // Bare Error.
      {
        code: "throw new Error('boom');",
        errors: [{ messageId: 'bareErrorThrow' }],
      },
      // Bare Error with a template literal message.
      {
        code: 'throw new Error(`boom ${code}`);',
        errors: [{ messageId: 'bareErrorThrow' }],
      },
      // Bare TypeError.
      {
        code: "throw new TypeError('bad type');",
        errors: [{ messageId: 'bareErrorThrow' }],
      },
      // Bare RangeError.
      {
        code: "throw new RangeError('out of range');",
        errors: [{ messageId: 'bareErrorThrow' }],
      },
      // Nested inside an if — still a throw of a bare Error.
      {
        code: "if (cond) { throw new Error('x'); }",
        errors: [{ messageId: 'bareErrorThrow' }],
      },
    ],
  });
});
