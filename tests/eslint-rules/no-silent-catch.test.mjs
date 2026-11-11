import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noSilentCatch from '../../eslint-rules/no-silent-catch.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
});

test('no-silent-catch', () => {
  ruleTester.run('no-silent-catch', noSilentCatch, {
    valid: [
      // Plain rethrow.
      'try { foo(); } catch (e) { throw e; }',
      // captureException via Sentry namespace.
      'try { foo(); } catch (e) { Sentry.captureException(e); }',
      // captureException as a bare imported name.
      'import { captureException } from "x"; try { foo(); } catch (e) { captureException(e); }',
      // Logging is fine as long as something also throws.
      'try { foo(); } catch (e) { console.log(e); throw new Error("x"); }',
      // Throw nested inside an if — the rule walks descendants.
      'try { foo(); } catch (e) { if (cond) { throw e; } else { throw new Error("y"); } }',
      // .catch with a throw in the callback body.
      'foo().catch((e) => { throw e; });',
      // .catch with captureException in an arrow expression body.
      'foo().catch((e) => Sentry.captureException(e));',
      // .catch with captureException in a block body.
      'foo().catch((e) => { Sentry.captureException(e); });',
      // .catch with a NAMED handler reference — out of our introspection
      // scope; we trust the named function to be doing the right thing.
      'foo().catch(handleError);',
    ],
    invalid: [
      // Empty catch.
      {
        code: 'try { foo(); } catch (e) {}',
        errors: [{ messageId: 'catchSilent' }],
      },
      // catch that only logs.
      {
        code: 'try { foo(); } catch (e) { console.log(e); }',
        errors: [{ messageId: 'catchSilent' }],
      },
      // .catch with arrow returning null.
      {
        code: 'foo().catch(() => null);',
        errors: [{ messageId: 'promiseCatchSilent' }],
      },
      // .catch with arrow that just logs.
      {
        code: 'foo().catch((e) => { console.log(e); });',
        errors: [{ messageId: 'promiseCatchSilent' }],
      },
      // .catch with arrow returning a value derived from the error but
      // still swallowing.
      {
        code: 'foo().catch((e) => e.message);',
        errors: [{ messageId: 'promiseCatchSilent' }],
      },
    ],
  });
});
