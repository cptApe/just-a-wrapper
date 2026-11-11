// import-style — one way to write an import path in src: `@/` across folders, `./` or `../`
// inside one feature (or one top-level src folder), and never a `.ts` or `.tsx` suffix.
import path from 'node:path';
import { importVisitors } from './feature-imports.mjs';

const SRC = /(?:^|\/)src\//;
const SUFFIX = /\.tsx?$/;

/** The folder a relative import may stay inside: the feature, else the top-level src folder. */
function scopeOf(file) {
  const normalized = file.split(path.sep).join('/');
  const match = /^(.*?\/src\/)(features\/[^/]+|[^/]+)(?:\/|$)/.exec(normalized);
  return match ? { root: match[1], scope: match[1] + match[2] } : null;
}

/** The path this import should use, or null when it already follows the style. */
export function preferredSpecifier(file, specifier) {
  const where = scopeOf(file);
  if (!where) return null;
  const bare = specifier.replace(SUFFIX, '');
  if (specifier.startsWith('@/')) return bare === specifier ? null : bare;
  if (!specifier.startsWith('.')) return null;
  const target = path.posix.resolve(path.posix.dirname(file.split(path.sep).join('/')), bare);
  const inside = target === where.scope || target.startsWith(`${where.scope}/`);
  if (inside) return bare === specifier ? null : bare;
  if (!target.startsWith(where.root)) return null;
  return `@/${target.slice(where.root.length)}`;
}

const rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        'Requires `@/` for imports that leave a feature or top-level src folder, and bans `.ts` suffixes.',
    },
    messages: {
      style: 'Import "{{source}}" as "{{preferred}}" (docs/spec/01-code-standard.md, imports).',
    },
    schema: [],
  },

  create(context) {
    const file = context.filename;
    if (!SRC.test(file.split(path.sep).join('/'))) return {};
    return importVisitors((source) => {
      const preferred = preferredSpecifier(file, source.value);
      if (preferred === null) return;
      context.report({
        node: source,
        messageId: 'style',
        data: { source: source.value, preferred },
        fix: (fixer) => fixer.replaceText(source, `'${preferred}'`),
      });
    });
  },
};

export default rule;
