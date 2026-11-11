// Capability phrasing for the integration detail modal: the human task-phrase
// ("Draft replies", "Search your inbox") shown for each action, with the raw
// slug as 12px meta. Pure functions — no fetches, unit-testable.
//
// Three tiers: hand-curated phrases for the most-used actions of the top
// connectors (written for non-technical users, second person where natural),
// then the catalog's own `name` (already a decent task phrase: "Create email
// draft"), then a prettified slug as the last resort.

const CURATED_PHRASES: Record<string, string> = {
  // Gmail
  GMAIL_SEND_EMAIL: 'Send email for you',
  GMAIL_CREATE_EMAIL_DRAFT: 'Draft replies and new emails',
  GMAIL_FETCH_EMAILS: 'Search and read your inbox',
  GMAIL_GET_ATTACHMENT: 'Open email attachments',
  GMAIL_ADD_LABEL_TO_EMAIL: 'Organize emails with labels',
  GMAIL_MOVE_TO_TRASH: 'Move emails to trash',
  GMAIL_REPLY_TO_THREAD: 'Reply in an email thread',
  // Google Calendar
  GOOGLECALENDAR_CREATE_EVENT: 'Add events to your calendar',
  GOOGLECALENDAR_EVENTS_LIST: 'Check your schedule',
  GOOGLECALENDAR_UPDATE_EVENT: 'Move or edit events',
  GOOGLECALENDAR_DELETE_EVENT: 'Remove events',
  GOOGLECALENDAR_FIND_FREE_SLOTS: 'Find times you’re free',
  // Google Drive
  GOOGLEDRIVE_FIND_FILE: 'Find files in your Drive',
  GOOGLEDRIVE_DOWNLOAD_FILE: 'Open and read your files',
  GOOGLEDRIVE_UPLOAD_FILE: 'Save new files to Drive',
  GOOGLEDRIVE_CREATE_FOLDER: 'Create folders',
  // Google Docs
  GOOGLEDOCS_CREATE_DOCUMENT: 'Write new documents',
  GOOGLEDOCS_GET_DOCUMENT_BY_ID: 'Read your documents',
  GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT: 'Edit documents for you',
  // Google Sheets
  GOOGLESHEETS_BATCH_GET: 'Read your spreadsheets',
  GOOGLESHEETS_BATCH_UPDATE: 'Update spreadsheet cells',
  GOOGLESHEETS_CREATE_GOOGLE_SHEET1: 'Create new spreadsheets',

  NOTION_SEARCH_NOTION_PAGE: 'Search your Notion pages',
  NOTION_CREATE_NOTION_PAGE: 'Create new pages',
  NOTION_ADD_PAGE_CONTENT: 'Add content to pages',
  NOTION_QUERY_DATABASE: 'Look things up in databases',
  // Slack
  SLACK_SEND_MESSAGE: 'Send messages where you work',
  SLACK_SEARCH_MESSAGES: 'Search your message history',
  SLACK_LIST_ALL_CHANNELS: 'See your channels',
  SLACK_CREATE_CHANNEL: 'Create channels',
  // GitHub
  GITHUB_CREATE_AN_ISSUE: 'File issues for you',
  GITHUB_LIST_REPOSITORY_ISSUES: 'Review open issues',
  GITHUB_CREATE_A_PULL_REQUEST: 'Open pull requests',
  GITHUB_GET_A_REPOSITORY: 'Look up repositories',
  // Linear
  LINEAR_CREATE_LINEAR_ISSUE: 'Create issues for you',
  LINEAR_LIST_LINEAR_ISSUES: 'Review your issues',
  LINEAR_UPDATE_ISSUE: 'Update issue status and details',
  // Outlook
  OUTLOOK_OUTLOOK_SEND_EMAIL: 'Send email for you',
  OUTLOOK_OUTLOOK_LIST_MESSAGES: 'Search and read your inbox',
  OUTLOOK_OUTLOOK_CREATE_DRAFT: 'Draft replies and new emails',
  // Dropbox
  DROPBOX_SEARCH_FILE_OR_FOLDER: 'Find files in your Dropbox',
  DROPBOX_DOWNLOAD_FILE: 'Open and read your files',
  DROPBOX_UPLOAD_FILE: 'Save new files to Dropbox',
  // HubSpot
  HUBSPOT_LIST_CONTACTS_PAGE: 'Look up your contacts',
  HUBSPOT_CREATE_NEW_CONTACT_OBJECT: 'Add new contacts',
  HUBSPOT_SEARCH_DEALS: 'Search deals in your pipeline',
};

/** Curated slugs sort the best-known actions first. */
export function isCuratedAction(slug: string): boolean {
  return slug in CURATED_PHRASES;
}

/** The human phrase for one action: curated → catalog name → prettified slug. */
export function capabilityPhrase(slug: string, catalogName: string): string {
  const curated = CURATED_PHRASES[slug];
  if (curated) return curated;
  if (catalogName.trim().length > 0) return catalogName.trim();
  return prettifySlug(slug);
}

/**
 * Row meta from the catalog description: the first sentence, with any raw
 * action ids the vendor copy mentions humanized away (SCREAMING_SNAKE ids are
 * developer vocabulary and render nowhere in the UI).
 */
export function describeAction(raw: string): string {
  const firstSentence = raw.trim().split(/(?<=[.!?])\s+/)[0] ?? '';
  return firstSentence.replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (id) => prettifySlug(id));
}

/**
 * Last-resort phrase from a raw action slug: drop the toolkit prefix, lowercase
 * the rest, capitalize the first word (GMAIL_SEND_EMAIL → "Send email").
 */
function prettifySlug(slug: string): string {
  const withoutPrefix = slug.includes('_') ? slug.slice(slug.indexOf('_') + 1) : slug;
  const words = withoutPrefix.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return slug;
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
