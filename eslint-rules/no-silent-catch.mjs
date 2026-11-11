// no-silent-catch — bans catches that swallow errors.
//
// Every `try { ... } catch (e) { ... }` block must either:
//   (a) contain a `throw` statement (anywhere in the block — including nested
//       ifs, switches, etc.), OR
//   (b) call something whose name ends in `captureException`.
//
// Same rule applies to `.catch(callback)` style handlers — the callback's
// body must contain a throw or a captureException call. `.catch(() => null)`,
// `.catch(e => undefined)`, and bare `.catch(() => {})` are all flagged.
//
// See docs/spec/04-observability.md §4.

const CAPTURE_RE = /captureException\s*$/;

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

function calleeMatches(node, sourceCode) {
  if (node.type !== 'CallExpression') return false;
  const text = sourceCode.getText(node.callee);
  return CAPTURE_RE.test(text);
}

function containsThrowOrCapture(node, sourceCode) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'ThrowStatement') return true;
  if (calleeMatches(node, sourceCode)) return true;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && item.type) {
          if (containsThrowOrCapture(item, sourceCode)) return true;
        }
      }
    } else if (value && typeof value === 'object' && value.type) {
      if (containsThrowOrCapture(value, sourceCode)) return true;
    }
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Bans silent catches. Every try/catch and .catch() must rethrow or call captureException.',
    },
    messages: {
      catchSilent: 'catch must rethrow or call captureException; silent swallows are banned',
      promiseCatchSilent:
        '.catch() must rethrow or call captureException — silent swallows are banned',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CatchClause(node) {
        if (!containsThrowOrCapture(node.body, sourceCode)) {
          context.report({ node, messageId: 'catchSilent' });
        }
      },

      "CallExpression[callee.type='MemberExpression'][callee.property.name='catch']"(node) {
        if (node.arguments.length === 0) return;
        const arg = node.arguments[0];
        if (arg.type !== 'ArrowFunctionExpression' && arg.type !== 'FunctionExpression') {
          // .catch(someNamedHandler) — assume the named handler is responsible
          // for throwing or capturing. We can't introspect arbitrary references.
          return;
        }
        const body = arg.body;
        if (body.type === 'BlockStatement') {
          if (!containsThrowOrCapture(body, sourceCode)) {
            context.report({ node: arg, messageId: 'promiseCatchSilent' });
          }
          return;
        }
        // Expression-bodied arrow (e.g. `e => null`, `e => foo(e)`).
        if (!containsThrowOrCapture(body, sourceCode)) {
          context.report({ node: arg, messageId: 'promiseCatchSilent' });
        }
      },
    };
  },
};

export default rule;
