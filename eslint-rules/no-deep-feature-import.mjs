// no-deep-feature-import — API routes reach a feature only through its public entries.

const DEEP_FEATURE_IMPORT = /^@\/features\/[^/]+\/(?!server$).+/;

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallows importing past a feature index or its server entry from API routes.',
    },
    messages: {
      deepFeatureImport:
        'Import "{{source}}" through "@/features/{{feature}}" or "@/features/{{feature}}/server".',
    },
    schema: [],
  },

  create(context) {
    function check(sourceNode) {
      if (sourceNode?.type !== 'Literal' || typeof sourceNode.value !== 'string') return;
      if (!DEEP_FEATURE_IMPORT.test(sourceNode.value)) return;
      context.report({
        node: sourceNode,
        messageId: 'deepFeatureImport',
        data: { source: sourceNode.value, feature: sourceNode.value.split('/')[2] },
      });
    }
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};

export default rule;
