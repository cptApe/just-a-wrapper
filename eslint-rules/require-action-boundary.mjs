// require-action-boundary — every exported server action opens request context.
//
// In a file whose first statement is the 'use server' directive, each exported
// function must call `runAction(...)` (a mutation returning ActionState) or
// `withRequestContext(...)` (a read that throws, used as a query function) in
// its body. Next exposes every export of such a file as a public endpoint, so
// an export without a boundary runs without request context and leaks raw
// errors. Helpers that are not actions belong in a module without the directive.
//
//   export async function save(x) { return runAction({ route: 'r', feature: 'f', message: 'm' }, () => write(x)); }
//   export async function load() { return withRequestContext({ route: 'r' }, () => read()); }

const BOUNDARY_NAMES = new Set(['runAction', 'withRequestContext']);
const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'start', 'end', 'tokens', 'comments']);

function callsBoundary(node, names) {
  if (!node || typeof node !== 'object') return false;
  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    names.has(node.callee.name)
  ) {
    return true;
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && item.type && callsBoundary(item, names)) {
          return true;
        }
      }
    } else if (value && typeof value === 'object' && value.type && callsBoundary(value, names)) {
      return true;
    }
  }
  return false;
}

function isFunctionNode(node) {
  return (
    node?.type === 'FunctionDeclaration' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'ArrowFunctionExpression'
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Every function exported from a 'use server' file must call runAction() or withRequestContext().",
    },
    messages: {
      missingBoundary:
        "server action '{{name}}' must go through runAction() (mutation) or withRequestContext() (read); move non-action helpers to a module without 'use server'",
    },
    schema: [],
  },

  create(context) {
    return {
      Program(program) {
        const isActionFile = program.body.some(
          (statement) =>
            statement.type === 'ExpressionStatement' && statement.directive === 'use server',
        );
        if (!isActionFile) return;

        // A file-local helper that itself calls a boundary (a feature's
        // `memoryAction(route, fn)` wrapper) counts as one for its callers.
        const names = new Set(BOUNDARY_NAMES);
        for (const statement of program.body) {
          if (statement.type === 'FunctionDeclaration' && statement.id) {
            if (callsBoundary(statement.body, names)) names.add(statement.id.name);
          } else if (statement.type === 'VariableDeclaration') {
            for (const declarator of statement.declarations) {
              if (declarator.id.type !== 'Identifier' || !isFunctionNode(declarator.init)) continue;
              if (callsBoundary(declarator.init.body, names)) names.add(declarator.id.name);
            }
          }
        }

        for (const statement of program.body) {
          if (statement.type !== 'ExportNamedDeclaration' || !statement.declaration) continue;
          const declaration = statement.declaration;
          if (declaration.type === 'FunctionDeclaration') {
            if (!callsBoundary(declaration.body, names)) {
              context.report({
                node: declaration.id ?? declaration,
                messageId: 'missingBoundary',
                data: { name: declaration.id?.name ?? 'default' },
              });
            }
          } else if (declaration.type === 'VariableDeclaration') {
            for (const declarator of declaration.declarations) {
              if (declarator.id.type !== 'Identifier') continue;
              const init = declarator.init;
              const ok = callsBoundary(isFunctionNode(init) ? init.body : init, names);
              if (!ok) {
                context.report({
                  node: declarator.id,
                  messageId: 'missingBoundary',
                  data: { name: declarator.id.name },
                });
              }
            }
          }
        }
      },
    };
  },
};

export default rule;
