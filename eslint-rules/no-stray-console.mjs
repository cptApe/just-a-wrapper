// no-stray-console — keeps product code on the structured house logger.

function isConsoleObject(node) {
  if (node.type === 'Identifier') return node.name === 'console';
  if (node.type !== 'MemberExpression' || node.computed) return false;
  return (
    node.object.type === 'Identifier' &&
    (node.object.name === 'globalThis' || node.object.name === 'window') &&
    node.property.type === 'Identifier' &&
    node.property.name === 'console'
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows console.* use outside explicit exemptions, including globalThis/window prefixes; aliases such as const c = console are out of scope.',
    },
    messages: {
      strayConsole:
        'Do not use console.* in product code. Use logger() from @/lib/logger, or remove the diagnostic.',
    },
    schema: [],
  },

  create(context) {
    return {
      MemberExpression(node) {
        if (isConsoleObject(node.object)) {
          context.report({ node, messageId: 'strayConsole' });
        }
      },
    };
  },
};

export default rule;
