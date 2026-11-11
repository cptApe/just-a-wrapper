// no-journal-comments — keeps source comments about present-day constraints.

const ISSUE_NUMBER_RE = /(^|[^\w])#(?!\d{6}\b|\d{8}\b)\d+\b/gi;
const DATE_RE = /\b20\d{2}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?\b/;
const STAGE_NUMBER_RE = /\bstage(?:\s+|-)\d+[a-z]?\b/i;
const PROCESS_WORD_RE = /\b(?:spike|(?<!subagent )lanes?)\b/i;
const THE_OLD_RE = /\bthe old\b/i;
const VERIFIED_RE = /\bverified\b/gi;
const URL_RE = /(?:https?:\/\/|[a-z\d.-]+\.[a-z]{2,}\/)/gi;

function hasNearbyMatch(value, leftRe, rightRe) {
  const left = [...value.matchAll(leftRe)];
  const right = [...value.matchAll(rightRe)];
  return left.some((a) => right.some((b) => Math.abs((a.index ?? 0) - (b.index ?? 0)) <= 160));
}

function hasVerifiedException(value) {
  return (
    hasNearbyMatch(value, VERIFIED_RE, new RegExp(DATE_RE.source, 'gi')) ||
    hasNearbyMatch(value, VERIFIED_RE, URL_RE)
  );
}

function hasIssueNumber(value) {
  for (const match of value.matchAll(ISSUE_NUMBER_RE)) {
    const hashIndex = (match.index ?? 0) + match[1].length;
    const prefix = value.slice(Math.max(0, hashIndex - 24), hashIndex);
    if (/\b(?:http(?: status)?|status(?: code)?)\s*$/i.test(prefix)) continue;
    const digits = /^\d+/.exec(value.slice(hashIndex + 1))?.[0] ?? '';
    if (
      (digits.length === 3 || digits.length === 4) &&
      /\b(?:colou?r|accent|brand|hex|palette|shade|tint)\b/i.test(prefix)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

export function journalKinds(value) {
  const kinds = [];
  if (hasIssueNumber(value)) kinds.push('issue number');
  if (STAGE_NUMBER_RE.test(value)) kinds.push('stage number');
  if (DATE_RE.test(value) && !hasVerifiedException(value)) kinds.push('date');
  if (PROCESS_WORD_RE.test(value)) kinds.push('process word');
  if (THE_OLD_RE.test(value)) kinds.push('reference to old code');
  return kinds;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Bans issue numbers, dates, numbered stages, process words, and references to old code in source comments.',
    },
    messages: {
      journalComment:
        'Remove the {{kinds}} from this comment. Explain the current constraint, not the project history.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;

    return {
      'Program:exit'() {
        for (const comment of sourceCode.getAllComments()) {
          const kinds = journalKinds(comment.value);
          if (kinds.length > 0) {
            context.report({
              loc: comment.loc,
              messageId: 'journalComment',
              data: { kinds: kinds.join(', ') },
            });
          }
        }
      },
    };
  },
};

export default rule;
