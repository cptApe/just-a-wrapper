// suppression-requires-reason — makes every local escape hatch explain itself.

const ESLINT_DISABLE_RE = /\beslint-disable(?:-next-line|-line)?\b/;
const TYPESCRIPT_DIRECTIVE_RE = /@ts-(?:expect-error|ignore|nocheck)\b/;
const BIOME_IGNORE_RE = /\bbiome-ignore\b/;

function hasWords(value) {
  return /[A-Za-z]{2}/.test(value);
}

function eslintHasReason(value) {
  const directive = value.match(ESLINT_DISABLE_RE);
  if (!directive) return true;
  const afterDirective = value.slice((directive.index ?? 0) + directive[0].length);
  const separator = afterDirective.lastIndexOf('--');
  return separator >= 0 && hasWords(afterDirective.slice(separator + 2));
}

function typescriptHasReason(value) {
  const directive = value.match(TYPESCRIPT_DIRECTIVE_RE);
  if (!directive) return true;
  const reason = value
    .slice((directive.index ?? 0) + directive[0].length)
    .replace(/^\s*[:—-]?\s*/, '');
  return hasWords(reason);
}

function biomeHasReason(value) {
  const directive = value.match(BIOME_IGNORE_RE);
  if (!directive) return true;
  const afterDirective = value.slice((directive.index ?? 0) + directive[0].length);
  const separator = afterDirective.indexOf(':');
  return separator >= 0 && hasWords(afterDirective.slice(separator + 1));
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Requires eslint-disable, TypeScript suppression, and biome-ignore comments to explain why.',
    },
    messages: {
      missingReason:
        'Suppression comments need a same-comment explanation of why the rule is inapplicable.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      'Program:exit'() {
        for (const comment of sourceCode.getAllComments()) {
          const value = comment.value;
          if (!eslintHasReason(value) || !typescriptHasReason(value) || !biomeHasReason(value)) {
            context.report({ loc: comment.loc, messageId: 'missingReason' });
          }
        }
      },
    };
  },
};

export default rule;
