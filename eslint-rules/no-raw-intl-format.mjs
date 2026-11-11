// no-raw-intl-format — every value a person reads is formatted by src/lib/format/ (decision 0043).

import { relative } from 'node:path';

const INTL_FORMATTERS = new Set(['DateTimeFormat', 'NumberFormat', 'RelativeTimeFormat']);
const LOCALE_METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);
const FORMAT_HOME = 'src/lib/format/';

function propertyName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal') return String(node.property.value);
  return null;
}

function repoRelative(context) {
  const filename = context.filename ?? context.getFilename();
  return relative(context.cwd ?? process.cwd(), filename).replaceAll('\\', '/');
}

function isAllowedFile(context) {
  const file = repoRelative(context);
  if (file.startsWith(FORMAT_HOME)) return true;
  const allowFiles = context.options[0]?.allowFiles ?? [];
  return allowFiles.some(({ path }) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  );
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallows Intl date, number and relative-time formatters and toLocale*String calls outside src/lib/format/.',
    },
    messages: {
      rawIntl:
        'Format values with src/lib/format/ (formatDate, formatClock, formatCount, formatMoney, ...), not Intl.{{name}}. Zone math files go on the allowlist in eslint.config.mjs with a reason.',
      rawLocale:
        'Format values with src/lib/format/ (formatDate, formatClock, formatCount, formatMoney, ...), not {{name}}(), which follows the runtime locale and zone.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowFiles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'reason'],
              properties: {
                path: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    ],
  },

  create(context) {
    if (isAllowedFile(context)) return {};
    return {
      MemberExpression(node) {
        const name = propertyName(node);
        if (
          name !== null &&
          INTL_FORMATTERS.has(name) &&
          node.object.type === 'Identifier' &&
          node.object.name === 'Intl'
        ) {
          context.report({ node, messageId: 'rawIntl', data: { name } });
        }
      },
      CallExpression(node) {
        const name = propertyName(node.callee);
        if (name !== null && LOCALE_METHODS.has(name)) {
          context.report({ node, messageId: 'rawLocale', data: { name } });
        }
      },
    };
  },
};

export default rule;
