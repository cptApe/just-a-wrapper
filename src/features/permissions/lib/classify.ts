import type { ToolPolicy } from '../types';

// Materialize exact action policies from Composio behavior tags at connect and repair.
// Settings, connection defaults and execution gates share the same catalog tags.

const READ_VERBS = new Set([
  'GET',
  'LIST',
  'FETCH',
  'SEARCH',
  'FIND',
  'READ',
  'QUERY',
  'RETRIEVE',
  'LOOKUP',
  'DOWNLOAD',
  'CHECK',
  'VIEW',
  'DESCRIBE',
  'COUNT',
  'EXPORT',
  'SHOW',
]);

const WRITE_VERBS = new Set([
  'CREATE',
  'ADD',
  'SEND',
  'UPDATE',
  'DELETE',
  'REMOVE',
  'MOVE',
  'WRITE',
  'EDIT',
  'PATCH',
  'POST',
  'UPLOAD',
  'SET',
  'RENAME',
  'ARCHIVE',
  'TRASH',
  'MARK',
  'REPLY',
  'FORWARD',
  'INSERT',
  'APPEND',
  'EXECUTE',
  'RUN',
  'MODIFY',
  'CANCEL',
  'ACCEPT',
  'DECLINE',
  'PUBLISH',
  'SCHEDULE',
  'MERGE',
  'CLOSE',
  'REOPEN',
  'ASSIGN',
  'INVITE',
  'SHARE',
  'GRANT',
  'REFUND',
  'CHARGE',
  'PAY',
  'TRANSFER',
  'WATCH',
  'REPLACE',
]);

const verbPattern = (verbs: ReadonlySet<string>): RegExp =>
  new RegExp(`^(?:${[...verbs].join('|')})(?:V?\\d+)?$`);
const READ_VERB_PATTERN = verbPattern(READ_VERBS);
const WRITE_VERB_PATTERN = verbPattern(WRITE_VERBS);

export type ToolAccess = 'read' | 'write';

export function defaultPolicyForToolAccess(access: ToolAccess): ToolPolicy {
  return access === 'read' ? 'allow' : 'ask';
}

/** The access group of one Composio action slug. */
export function classifyToolAccess(toolName: string, tags: readonly string[] = []): ToolAccess {
  // A conflicting upstream annotation fails closed. A destructive tool must
  // never become a silent read because it also carries a malformed read tag.
  if (
    tags.includes('destructiveHint') ||
    tags.includes('createHint') ||
    tags.includes('updateHint')
  ) {
    return 'write';
  }
  if (tags.includes('readOnlyHint')) return 'read';
  const tokens = toolName.toUpperCase().split('_');
  if (tokens.some((token) => WRITE_VERB_PATTERN.test(token))) return 'write';
  if (tokens.some((token) => READ_VERB_PATTERN.test(token))) return 'read';
  return 'write';
}
