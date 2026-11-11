// no-bare-error-throw — bans throwing a bare built-in Error.
//
// Every throw in this repo must be an `AppError` subclass from
// `src/lib/errors.ts` (ToolError / IntegrationError / BillingError /
// WebhookError / AuthorizationError / AppError) carrying a stable `code`,
// structured `context`, and a native `cause` when wrapping. A bare
// `throw new Error('...')` gives callers and logs nothing machine-actionable.
//
// The rule flags a `throw` whose argument is `new Error(...)`,
// `new TypeError(...)`, or `new RangeError(...)` — the built-in constructors we
// see misused. It matches on the constructor identifier only; subclasses
// (`new ToolError(...)`) and rethrows (`throw err`) are untouched.
//
// See docs/spec/04-observability.md §2.

const BANNED_CONSTRUCTORS = new Set(['Error', 'TypeError', 'RangeError']);

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Bans throwing a bare built-in Error. Throw an AppError subclass from src/lib/errors.ts instead.',
    },
    messages: {
      bareErrorThrow:
        'throw an AppError subclass from @/lib/errors (with a code + context) — bare `new {{ctor}}(...)` throws carry nothing machine-actionable',
    },
    schema: [],
  },

  create(context) {
    return {
      ThrowStatement(node) {
        const arg = node.argument;
        if (!arg || arg.type !== 'NewExpression') return;
        if (arg.callee.type !== 'Identifier') return;
        if (!BANNED_CONSTRUCTORS.has(arg.callee.name)) return;
        context.report({
          node: arg,
          messageId: 'bareErrorThrow',
          data: { ctor: arg.callee.name },
        });
      },
    };
  },
};

export default rule;
