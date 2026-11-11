// no-upward-feature-import — a feature imports only lower layers, or features listed before it in
// its own layer (eslint-rules/feature-layers.mjs). The rule is local to each import, so cycles
// cannot form.

import { featureOfFile, featureOfImport, importVisitors } from './feature-imports.mjs';
import FEATURE_LAYERS from './feature-layers.mjs';

const TABLE = 'eslint-rules/feature-layers.mjs';

/** Position of every feature: its layer index and its index in the whole ordered table. */
export function featurePositions(layers) {
  const positions = new Map();
  let order = 0;
  layers.forEach(({ layer, features }, layerIndex) => {
    for (const feature of features) positions.set(feature, { layer, layerIndex, order: order++ });
  });
  return positions;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallows a feature importing a higher layer or a later feature in its layer.',
    },
    messages: {
      upward: `"{{from}}" ({{fromLayer}} layer) may not import "{{to}}" ({{toLayer}} layer): a feature imports only lower layers, or features listed before it in its own layer (${TABLE}). Move the shared piece down to the lower feature or to src/lib / src/components, or pass the behaviour in as a parameter or prop.`,
      sameLayer: `"{{from}}" may not import "{{to}}": both are in the {{layer}} layer and "{{to}}" is listed after "{{from}}".`,
      unknown: `"{{feature}}" is not in ${TABLE}. Add it to the layer it belongs in.`,
    },
    schema: [
      {
        type: 'object',
        properties: { layers: { type: 'array' } },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const from = featureOfFile(context.filename);
    if (from === null) return {};
    const positions = featurePositions(context.options[0]?.layers ?? FEATURE_LAYERS);
    const own = positions.get(from);
    let reportedUnknown = false;
    return importVisitors((source) => {
      const to = featureOfImport(context.filename, source.value);
      if (to === null || to === from) return;
      if (!own) {
        if (reportedUnknown) return;
        reportedUnknown = true;
        context.report({ node: source, messageId: 'unknown', data: { feature: from } });
        return;
      }
      const target = positions.get(to);
      if (!target) {
        context.report({ node: source, messageId: 'unknown', data: { feature: to } });
        return;
      }
      if (target.layerIndex > own.layerIndex) {
        context.report({
          node: source,
          messageId: 'upward',
          data: { from, fromLayer: own.layer, to, toLayer: target.layer },
        });
      } else if (target.layerIndex === own.layerIndex && target.order > own.order) {
        context.report({
          node: source,
          messageId: 'sameLayer',
          data: { from, to, layer: own.layer },
        });
      }
    });
  },
};

export default rule;
