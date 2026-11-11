// no-shared-feature-import — shared layers sit below features, so they never import one.
// eslint.config.mjs scopes it to src/lib, src/hooks, src/components and src/db.
import { featureOfImport, importVisitors } from './feature-imports.mjs';

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallows imports of a feature from a shared layer.' },
    messages: {
      sharedFeatureImport:
        'Shared code cannot import "{{source}}" (code standard 6.2). Move the code into the feature that owns it, or take the behaviour as a prop.',
    },
    schema: [],
  },

  create(context) {
    return importVisitors((source) => {
      if (featureOfImport(context.filename, source.value) === null) return;
      context.report({
        node: source,
        messageId: 'sharedFeatureImport',
        data: { source: source.value },
      });
    });
  },
};

export default rule;
