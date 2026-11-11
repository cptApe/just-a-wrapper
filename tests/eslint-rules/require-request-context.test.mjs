import { test } from 'node:test';
import { RuleTester } from 'eslint';
import requireRequestContext from '../../eslint-rules/require-request-context.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
  },
});

// A route handler file the rule should enforce.
const ROUTE = 'src/app/api/auth/[...all]/route.ts';
// A non-route file the rule must ignore entirely.
const NON_ROUTE = 'src/features/workspaces/api/provision.ts';

test('require-request-context', () => {
  ruleTester.run('require-request-context', requireRequestContext, {
    valid: [
      // function-declaration handler wrapping its body.
      {
        filename: ROUTE,
        code: "export function GET(req) { return withRequestContext({ route: 'auth' }, () => handlers.GET(req)); }",
      },
      // const arrow handler wrapping its body.
      {
        filename: ROUTE,
        code: "export const POST = (req) => withRequestContext({ route: 'auth' }, () => handlers.POST(req));",
      },
      // Wrapper nested deeper inside the body (still present).
      {
        filename: ROUTE,
        code: "export async function GET(req) { const h = await headers(); return withRequestContext({ route: 'auth' }, async () => run(req)); }",
      },
      // withApiRoute assigned to the export — it RETURNS the handler, so the
      // call itself is the valid shape.
      {
        filename: ROUTE,
        code: "export const POST = withApiRoute({ route: 'x' }, async (req) => handle(req));",
      },
      // withApiRoute called inside a function-declaration handler body.
      {
        filename: ROUTE,
        code: "export function GET(req) { return withApiRoute({ route: 'x' }, () => run(req))(req); }",
      },
      // Non-HTTP-method export in a route file is not a handler → ignored.
      {
        filename: ROUTE,
        code: "export const runtime = 'nodejs';",
      },
      // Same unwrapped code, but NOT a route file → rule no-ops.
      {
        filename: NON_ROUTE,
        code: 'export const { GET, POST } = toNextJsHandler(auth);',
      },
      {
        filename: NON_ROUTE,
        code: 'export function GET(req) { return handlers.GET(req); }',
      },
    ],
    invalid: [
      // Bare re-export of toNextJsHandler result — the original bug. Each
      // HTTP method bound in the destructure is flagged.
      {
        filename: ROUTE,
        code: 'export const { GET, POST } = toNextJsHandler(auth);',
        errors: [
          { messageId: 'missingContext', data: { name: 'GET' } },
          { messageId: 'missingContext', data: { name: 'POST' } },
        ],
      },
      // function handler with no wrapper call.
      {
        filename: ROUTE,
        code: 'export function GET(req) { return handlers.GET(req); }',
        errors: [{ messageId: 'missingContext', data: { name: 'GET' } }],
      },
      // const arrow handler with no wrapper call.
      {
        filename: ROUTE,
        code: 'export const POST = (req) => handlers.POST(req);',
        errors: [{ messageId: 'missingContext', data: { name: 'POST' } }],
      },
      // const handler that is a bare reference (no inline wrapper).
      {
        filename: ROUTE,
        code: 'export const GET = handlers.GET;',
        errors: [{ messageId: 'missingContext', data: { name: 'GET' } }],
      },
    ],
  });
});
