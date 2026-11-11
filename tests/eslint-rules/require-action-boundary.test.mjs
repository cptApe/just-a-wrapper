import { test } from 'node:test';
import { RuleTester } from 'eslint';
import requireActionBoundary from '../../eslint-rules/require-action-boundary.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('require-action-boundary', () => {
  ruleTester.run('require-action-boundary', requireActionBoundary, {
    valid: [
      // A mutation through runAction.
      {
        code: "'use server'; export async function save(x) { return runAction({ route: 'r', feature: 'f', message: 'm' }, () => write(x)); }",
      },
      // A throwing read wrapped in withRequestContext.
      {
        code: "'use server'; export async function load() { return withRequestContext({ route: 'r' }, async () => read()); }",
      },
      // Arrow export.
      {
        code: "'use server'; export const save = async (x) => runAction({ route: 'r', feature: 'f', message: 'm' }, () => write(x));",
      },
      // Non-exported helpers are not actions.
      {
        code: "'use server'; async function helper() { return 1; } export async function load() { return withRequestContext({ route: 'r' }, helper); }",
      },
      // A file-local wrapper that calls runAction is a boundary for its callers.
      {
        code: "'use server'; function featureAction(route, fn) { return runAction({ route, feature: 'f', message: 'm' }, fn); } export async function save(x) { return featureAction('r', () => write(x)); }",
      },
      // No directive: the rule does not apply.
      { code: 'export async function helper(headers) { return read(headers); }' },
    ],
    invalid: [
      {
        code: "'use server'; export async function load() { return read(); }",
        errors: [{ messageId: 'missingBoundary', data: { name: 'load' } }],
      },
      {
        code: "'use server'; export const save = async (x) => write(x);",
        errors: [{ messageId: 'missingBoundary', data: { name: 'save' } }],
      },
      // A hand-rolled try/catch result is still flagged.
      {
        code: "'use server'; export async function save(x) { try { return { ok: true, data: await write(x) }; } catch { return { ok: false }; } }",
        errors: [{ messageId: 'missingBoundary', data: { name: 'save' } }],
      },
      // A local helper without a boundary does not count as one.
      {
        code: "'use server'; function plain(route, fn) { return fn(); } export async function save(x) { return plain('r', () => write(x)); }",
        errors: [{ messageId: 'missingBoundary', data: { name: 'save' } }],
      },
      // Only the offending export is reported.
      {
        code: "'use server'; export async function a() { return runAction({}, () => 1); } export async function b() { return 2; }",
        errors: [{ messageId: 'missingBoundary', data: { name: 'b' } }],
      },
    ],
  });
});
