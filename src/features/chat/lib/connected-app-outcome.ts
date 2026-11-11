import { toolkitFromToolName } from '@/features/permissions/lib/resolve';
import { COMPOSIO_TOOLKIT_ALLOWLIST, TOOLKIT_METADATA } from '@/lib/composio/toolkits';
import { recordOf } from './record-of';
import { titleCase } from './title-case';

type OutcomeReader = (
  data: Record<string, unknown>,
  input: Record<string, unknown>,
) => string | null;

const READ_VERBS = new Set(['FETCH', 'LIST', 'SEARCH', 'FIND', 'GET', 'QUERY']);
const ARRAY_KEYS = [
  'messages',
  'emails',
  'events',
  'items',
  'results',
  'files',
  'issues',
  'pages',
  'rows',
  'values',
  'records',
  'orders',
  'data',
] as const;
const WRITE_VERBS: Record<string, string> = {
  SEND: 'Sent',
  CREATE: 'Created',
  ADD: 'Added',
  APPEND: 'Added',
  INSERT: 'Added',
  POST: 'Posted',
  REPLY: 'Replied to',
  UPDATE: 'Updated',
  EDIT: 'Updated',
  DELETE: 'Deleted',
  REMOVE: 'Removed',
  ARCHIVE: 'Archived',
  MOVE: 'Moved',
  UPLOAD: 'Uploaded',
};
const NAME_KEYS = ['subject', 'title', 'summary', 'name'] as const;
const PREPOSITIONS = new Set(['FOR', 'IN', 'INTO', 'OF', 'ON', 'TO', 'WITH', 'FROM', 'BY', 'AT']);
const UNINFLECTABLE_NOUNS = new Set([
  'people',
  'media',
  'metadata',
  'info',
  'data',
  'children',
  'replace',
]);
const STOPLIST_NOUNS = new Set([
  'put',
  'all',
  'batch',
  'bulk',
  'database',
  'update',
  'invoiceitem',
  'statistics',
]);
const OVERRIDE_APPS: Partial<Record<string, string>> = {
  GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER: 'GitHub',
  LINEAR_LIST_LINEAR_ISSUES: 'Linear',
};
const OVERRIDES_WITH_APP_IN_PHRASE = new Set([
  'FACEBOOK_CREATE_POST',
  'INSTAGRAM_POST_IG_USER_MEDIA',
  'LINKEDIN_CREATE_LINKED_IN_POST',
]);
const STRICT_OVERRIDES = new Set(['GMAIL_SEND_EMAIL']);
const TOOLKIT_NAMES: Partial<Record<string, string>> = {
  GOOGLEMEET: 'Google Meet',
  GOOGLETASKS: 'Google Tasks',
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
  ONENOTE: 'OneNote',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
  ZOOMINFO: 'ZoomInfo',
};
const APP_NAME_FRAGMENTS = new Set([
  ...COMPOSIO_TOOLKIT_ALLOWLIST.flatMap((slug) => slug.split('_')),
  ...Object.values(TOOLKIT_METADATA).flatMap((toolkit) =>
    toolkit.name.toLowerCase().split(/[^a-z0-9]+/),
  ),
  'ig',
  'linked',
  'in',
  'fb',
  'yt',
  'gdrive',
  'onedrive',
]);

/** The display name for a connected-app action slug. */
export function connectedAppName(slug: string): string {
  const toolkit = toolkitFromToolName(slug, COMPOSIO_TOOLKIT_ALLOWLIST);
  const resolvedToolkit = COMPOSIO_TOOLKIT_ALLOWLIST.find((candidate) => candidate === toolkit);
  if (resolvedToolkit) return TOOLKIT_METADATA[resolvedToolkit].name;
  const firstWord = slug.split('_')[0] ?? '';
  const actionName = OVERRIDE_APPS[slug];
  if (actionName !== undefined) return actionName;
  return TOOLKIT_NAMES[firstWord] ?? titleCase(firstWord);
}

function countLine(verb: string, count: number, one: string, many: string): string {
  if (count === 0) return `${verb} no ${many}`;
  return `${verb} ${count} ${count === 1 ? one : many}`;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function hasString(data: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => typeof data[key] === 'string' && data[key].length > 0);
}

function shortName(data: Record<string, unknown>, input: Record<string, unknown>): string | null {
  for (const source of [data, input]) {
    for (const key of NAME_KEYS) {
      const value = source[key];
      if (typeof value !== 'string') continue;
      const name = value.trim();
      if (name.length > 0 && name.length <= 60) return name;
    }
  }
  return null;
}

function namedLine(
  line: string,
  data: Record<string, unknown>,
  input: Record<string, unknown>,
): string {
  const name = shortName(data, input);
  return `${line}${name ? ` “${name}”` : ''}`;
}

const OVERRIDES: Partial<Record<string, OutcomeReader>> = {
  GMAIL_FETCH_EMAILS: (data) => {
    const length = arrayLength(data.messages);
    return length === null ? null : countLine('Found', length, 'email', 'emails');
  },
  GMAIL_SEND_EMAIL: (data, input) =>
    hasString(data, 'id', 'message_id', 'threadId', 'thread_id')
      ? namedLine('Sent the email', data, input)
      : null,
  OUTLOOK_SEND_EMAIL: (data, input) =>
    hasString(data, 'id') ? namedLine('Sent the email', data, input) : null,
  GOOGLESHEETS_BATCH_GET: (data) => {
    if (!Array.isArray(data.valueRanges)) return null;
    let rows = 0;
    for (const rawRange of data.valueRanges) {
      const range = recordOf(rawRange);
      if (!range) return null;
      if (range.values === undefined) continue;
      if (!Array.isArray(range.values)) return null;
      rows += range.values.length;
    }
    return countLine('Read', rows, 'row', 'rows');
  },
  GOOGLESHEETS_CREATE_SPREADSHEET_ROW: (data) =>
    hasString(data, 'spreadsheetId') || typeof data.updatedRows === 'number'
      ? 'Created the spreadsheet row'
      : null,
  GOOGLECALENDAR_FIND_EVENT: (data) => {
    const events = recordOf(data.event_data)?.event_data;
    const length = arrayLength(events);
    return length === null ? null : countLine('Found', length, 'event', 'events');
  },
  GOOGLECALENDAR_CREATE_EVENT: (data, input) => {
    const response = recordOf(data.response_data);
    return response && hasString(response, 'id', 'htmlLink')
      ? namedLine('Created the event', data, input)
      : null;
  },
  LINEAR_LIST_LINEAR_ISSUES: (data) => {
    const length = arrayLength(data.issues);
    return length === null ? null : countLine('Found', length, 'issue', 'issues');
  },
  NOTION_SEARCH_NOTION_PAGE: (data) => {
    const length = arrayLength(data.results);
    return length === null ? null : countLine('Found', length, 'page', 'pages');
  },
  GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER: (data) => {
    const length = arrayLength(data.repositories);
    return length === null ? null : countLine('Found', length, 'repository', 'repositories');
  },
  CALENDLY_LIST_EVENT_TYPES: (data) => {
    const length = arrayLength(data.events);
    return length === null ? null : countLine('Found', length, 'event type', 'event types');
  },
  GOOGLEDRIVE_FIND_FILE: (data) => {
    const length = arrayLength(data.files);
    return length === null ? null : countLine('Found', length, 'file', 'files');
  },
  GOOGLEDOCS_CREATE_DOCUMENT: (data, input) =>
    hasString(data, 'documentId', 'document_id', 'id')
      ? namedLine('Created the document', data, input)
      : null,
  GOOGLESLIDES_CREATE_PRESENTATION: (data, input) =>
    hasString(data, 'presentationId', 'presentation_id', 'id')
      ? namedLine('Created the presentation', data, input)
      : null,
  ONE_DRIVE_LIST_FOLDER_CHILDREN: (data) => {
    const length = arrayLength(data.items);
    return length === null ? null : countLine('Found', length, 'file', 'files');
  },
  DROPBOX_UPLOAD_FILE: (data) => (hasString(data, 'id') ? 'Uploaded the file' : null),
  STRIPE_LIST_INVOICES: (data) => {
    const length = arrayLength(data.data);
    return length === null ? null : countLine('Found', length, 'invoice', 'invoices');
  },
  SQUARE_SEARCH_ORDERS: (data) => {
    const length = arrayLength(data.orders);
    return length === null ? null : countLine('Found', length, 'order', 'orders');
  },
  HUBSPOT_CREATE_CONTACT: (data) => (hasString(data, 'id') ? 'Created the contact' : null),
  QUICKBOOKS_CREATE_INVOICE: (data) => (hasString(data, 'Id', 'id') ? 'Created the invoice' : null),
  FACEBOOK_CREATE_POST: (data) => (hasString(data, 'id') ? 'Posted to Facebook' : null),
  INSTAGRAM_POST_IG_USER_MEDIA: (data) => (hasString(data, 'id') ? 'Posted to Instagram' : null),
  LINKEDIN_CREATE_LINKED_IN_POST: (data) => (hasString(data, 'id') ? 'Posted to LinkedIn' : null),
  YOUTUBE_LIST_CHANNEL_VIDEOS: (data) => {
    const length = arrayLength(data.items);
    return length === null ? null : countLine('Found', length, 'channel video', 'channel videos');
  },
  MAILCHIMP_ADD_CONTACT_TO_AUDIENCE: (data) => (hasString(data, 'id') ? 'Added the contact' : null),
  CANVA_POST_DESIGNS: (data, input) => {
    const design = recordOf(data.design);
    return design && hasString(design, 'id') ? namedLine('Posted the design', design, input) : null;
  },
};

function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function pluralize(word: string): string {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (word.endsWith('s') || word.endsWith('sh') || word.endsWith('ch')) return `${word}es`;
  return `${word}s`;
}

function nounForms(words: string[]): { one: string; many: string; plural: boolean } | null {
  const nounWords =
    words[0] === 'A' || words[0] === 'AN' || words[0] === 'THE' ? words.slice(1) : words;
  const prepositionIndex = nounWords.findIndex((word) => PREPOSITIONS.has(word));
  const headWords = nounWords.slice(0, prepositionIndex === -1 ? undefined : prepositionIndex);
  const lower = headWords.map((word) => word.toLowerCase());
  if (
    lower.length === 0 ||
    lower.length > 2 ||
    lower.some(
      (word) =>
        word.length < 3 ||
        UNINFLECTABLE_NOUNS.has(word) ||
        STOPLIST_NOUNS.has(word) ||
        APP_NAME_FRAGMENTS.has(word),
    )
  ) {
    return null;
  }
  const headIndex = lower.length - 1;
  const first = lower.at(0);
  const head = lower.at(-1);
  if (!first || !head) return null;
  if (lower.length === 2 && singularize(first) !== first) return null;
  const singularHead = singularize(head);
  const one = [...lower];
  const many = [...lower];
  one[headIndex] = singularHead;
  many[headIndex] = pluralize(singularHead);
  return {
    one: one.join(' '),
    many: many.join(' '),
    plural: lower[headIndex] !== singularHead,
  };
}

function withApp(slug: string, line: string): string {
  return `${line} with ${connectedAppName(slug)}`;
}

/** A result-backed settled line for an allowlisted connected-app action. */
export function connectedAppDoneLine(
  slug: string,
  input: Record<string, unknown>,
  data: unknown,
): string | null {
  const payload = recordOf(data);
  if (!payload) return null;

  const overrideReader = OVERRIDES[slug];
  if (overrideReader) {
    const override = overrideReader(payload, input);
    if (override)
      return OVERRIDES_WITH_APP_IN_PHRASE.has(slug) ? override : withApp(slug, override);
    if (STRICT_OVERRIDES.has(slug)) return null;
  }

  const toolkit = toolkitFromToolName(slug, COMPOSIO_TOOLKIT_ALLOWLIST);
  if (!toolkit) return null;
  const words = slug.split('_').slice(toolkit.split('_').length);
  const [verb, ...nounWords] = words;
  const firstPreposition = nounWords.find((word) => PREPOSITIONS.has(word));
  if (verb && WRITE_VERBS[verb] && (firstPreposition === 'TO' || firstPreposition === 'FROM'))
    return null;
  const nouns = nounForms(nounWords);
  if (!verb || !nouns) return null;

  if (READ_VERBS.has(verb)) {
    if (!nouns.plural) return null;
    for (const key of ARRAY_KEYS) {
      const values = payload[key];
      if (Array.isArray(values)) {
        return withApp(slug, countLine('Found', values.length, nouns.one, nouns.many));
      }
    }
    return null;
  }

  const past = WRITE_VERBS[verb];
  if (!past || Object.keys(payload).length === 0) return null;
  return withApp(slug, namedLine(`${past} the ${nouns.one}`, payload, input));
}
