// require-request-context — every Next.js route handler must open a request
// context.
//
// In any file whose path matches `src/app/api/**/route.ts`, each exported HTTP
// method handler (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) must call
// `withRequestContext(...)` somewhere in its body. Without it, requireCtx()
// throws downstream and logs/captured exceptions lose request_id / trace_id.
//
// Both export shapes are checked:
//   export function GET(req) { return withRequestContext({ route: 'x' }, () => ...); }
//   export const GET = (req) => withRequestContext({ route: 'x' }, () => ...);
//
// A handler that delegates to a named wrapper is the caller's responsibility —
// but the wrapper call must be literally present, so re-exporting a bare
// `toNextJsHandler(auth)` result (`export const { GET, POST } = ...`) is flagged.
//
// `withApiRoute(...)` (src/lib/route-kit.ts) is the higher-level wrapper that
// composes `withRequestContext` + try/catch + capture; a handler built on it is
// equally valid, so either call satisfies the rule.
//
// See AGENTS.md hard rules + docs/spec/03-patterns.md §5.

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// Either wrapper opens the request context: the low-level primitive or the
// route kit that composes it.
const WRAPPER_NAMES = new Set(['withRequestContext', 'withApiRoute']);

// Only enforce inside route handler files. Match both `/` and `\` separators so
// the rule works regardless of platform; tests pass an explicit filename.
const ROUTE_FILE_RE = /src[/\\]app[/\\]api[/\\].*[/\\]route\.tsx?$/;

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

function callsWrapper(node) {
  if (!node || typeof node !== 'object') return false;
  if (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    WRAPPER_NAMES.has(node.callee.name)
  ) {
    return true;
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && item.type && callsWrapper(item)) return true;
      }
    } else if (value && typeof value === 'object' && value.type) {
      if (callsWrapper(value)) return true;
    }
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Every exported route handler must run inside withApiRoute or withRequestContext so requireCtx() resolves.',
    },
    messages: {
      missingContext:
        "route handler '{{name}}' must use withApiRoute or withRequestContext({ route: '...' }); without it requireCtx() throws and logs lose request_id/trace_id",
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (!ROUTE_FILE_RE.test(filename)) return {};

    function check(name, fnNode, reportNode) {
      if (!HTTP_METHODS.has(name)) return;
      if (
        fnNode &&
        (fnNode.type === 'FunctionDeclaration' ||
          fnNode.type === 'FunctionExpression' ||
          fnNode.type === 'ArrowFunctionExpression')
      ) {
        // A handler function: the wrapper call must appear inside its body.
        if (!callsWrapper(fnNode.body)) {
          context.report({ node: reportNode, messageId: 'missingContext', data: { name } });
        }
        return;
      }
      // A non-function initializer. The one valid shape is an assignment of a
      // wrapper call itself — `export const POST = withApiRoute({...}, handler)`
      // — since withApiRoute RETURNS the handler. A bare reference
      // (`export const GET = handlers.GET`) is the unwrapped re-export we catch.
      if (!fnNode || !callsWrapper(fnNode)) {
        context.report({ node: reportNode, messageId: 'missingContext', data: { name } });
      }
    }

    return {
      // export function GET(...) { ... }
      'ExportNamedDeclaration > FunctionDeclaration'(node) {
        if (node.id) check(node.id.name, node, node.id);
      },
      // export const GET = (...) => ... / export const GET = function () {}
      'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator'(node) {
        if (node.id.type !== 'Identifier') {
          // export const { GET, POST } = toNextJsHandler(auth) — destructured
          // re-export with no per-handler wrapper. Flag each HTTP method bound.
          if (node.id.type === 'ObjectPattern') {
            for (const prop of node.id.properties) {
              if (
                prop.type === 'Property' &&
                prop.key.type === 'Identifier' &&
                HTTP_METHODS.has(prop.key.name)
              ) {
                context.report({
                  node: prop.key,
                  messageId: 'missingContext',
                  data: { name: prop.key.name },
                });
              }
            }
          }
          return;
        }
        check(node.id.name, node.init, node.id);
      },
    };
  },
};

export default rule;
