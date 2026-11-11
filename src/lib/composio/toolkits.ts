// The connected-app catalog a fork edits: allowlist, groups and display copy. Pure data.
// Probe each new lowercase slug alone and in the combined mint (one bad slug fails all), then
// run pnpm composio:remint: a cached session keeps the allowlist it was minted with.
export const COMPOSIO_TOOLKIT_ALLOWLIST = [
  // Email & calendar
  'gmail',
  'outlook',
  'googlecalendar',
  'calendly',
  // Files & docs
  'googledrive',
  'googledocs',
  'googlesheets',
  'googleslides',
  'one_drive',
  'dropbox',
  'notion',
  // Money & CRM
  'stripe',
  'square',
  'hubspot',
  'quickbooks',
  // Marketing & social
  'facebook',
  'instagram',
  'linkedin',
  'youtube',
  'mailchimp',
  'canva',
] as const;

export type ToolkitSlug = (typeof COMPOSIO_TOOLKIT_ALLOWLIST)[number];

// Curated display groups keep catalog shelves readable; tags feed search only.
export const TOOLKIT_GROUPS = [
  { id: 'email-calendar', label: 'Email & calendar' },
  { id: 'files-docs', label: 'Files & docs' },
  { id: 'money-crm', label: 'Money & CRM' },
  { id: 'marketing-social', label: 'Marketing & social' },
] as const;

export type ToolkitGroupId = (typeof TOOLKIT_GROUPS)[number]['id'];

// The Apps tab renders exactly the allowlist, each looked up here, so a toolkit needs an
// allowlist entry and a row. `summary`, `examples` and `websiteUrl` are the Overview copy.
export type ToolkitMeta = {
  slug: ToolkitSlug;
  name: string;
  blurb: string;
  group: ToolkitGroupId;
  tags: readonly string[];
  // Two or three plain present-tense sentences on what the agent does with this app.
  summary: string;
  // Three requests a small-business owner would type, shown under "Try asking".
  examples: readonly [string, string, string];
  // Static, so the link renders with the modal and never shifts the layout.
  websiteUrl: string;
};

// Blurbs name useful work in five or six words, verb first, without periods or API terms.
export const TOOLKIT_METADATA: Record<ToolkitSlug, ToolkitMeta> = {
  gmail: {
    slug: 'gmail',
    name: 'Gmail',
    blurb: 'Draft replies and clear your inbox',
    group: 'email-calendar',
    tags: ['email', 'inbox', 'google', 'mail'],
    summary:
      'Your agent searches your inbox, sums up long threads, and drafts replies or new emails. It can send email, reply inside a thread, and pull details out of attachments. It also adds labels and moves junk to the trash.',
    examples: [
      'Summarize my unread Gmail from today',
      'Which Gmail threads still need my reply?',
      'Find invoices in my Gmail from last month',
    ],
    websiteUrl: 'https://mail.google.com',
  },
  outlook: {
    slug: 'outlook',
    name: 'Outlook',
    blurb: 'Search, draft, and send Outlook email',
    group: 'email-calendar',
    tags: ['email', 'inbox', 'microsoft', 'mail'],
    summary:
      'Your agent searches your Outlook mail, sums up what came in, and drafts replies or new emails. It can send email for you and add events to your Outlook calendar.',
    examples: [
      'Summarize my unread Outlook email',
      'Which Outlook emails from this week need a reply?',
      'Find files sent to my Outlook this week',
    ],
    websiteUrl: 'https://outlook.live.com',
  },
  googlecalendar: {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    blurb: 'Check your week and book meetings',
    group: 'email-calendar',
    tags: ['calendar', 'meetings', 'schedule', 'google'],
    summary:
      'Your agent reads your calendar to tell you what your week looks like and when you are free. It can create events, move them when plans change, and delete the ones you no longer need.',
    examples: [
      'What’s on my Google Calendar this week?',
      'Find a free hour on my Google Calendar tomorrow',
      'Block Friday afternoon on my Google Calendar',
    ],
    websiteUrl: 'https://calendar.google.com',
  },
  calendly: {
    slug: 'calendly',
    name: 'Calendly',
    blurb: 'Send booking links and track meetings',
    group: 'email-calendar',
    tags: ['calendar', 'booking', 'scheduling', 'meetings'],
    summary:
      'Your agent looks up your Calendly event types and finds the right booking link to send a client. It also tells you who booked, which meeting they picked, and what is coming up.',
    examples: [
      'Who booked Calendly calls with me this week?',
      'Give me my Calendly booking link',
      'Which Calendly calls got canceled this month?',
    ],
    websiteUrl: 'https://calendly.com',
  },
  googledrive: {
    slug: 'googledrive',
    name: 'Google Drive',
    blurb: 'Find and read your Drive files',
    group: 'files-docs',
    tags: ['files', 'storage', 'documents', 'google'],
    summary:
      'Your agent finds files in your Drive by name or by what is inside them, then reads them and pulls out what you need. It can also save new files and create folders.',
    examples: [
      'What changed in my Google Drive this week?',
      'Find my most recent proposal in Google Drive',
      'Summarize the newest PDF in my Google Drive',
    ],
    websiteUrl: 'https://drive.google.com',
  },
  googledocs: {
    slug: 'googledocs',
    name: 'Google Docs',
    blurb: 'Write, edit, and polish documents',
    group: 'files-docs',
    tags: ['documents', 'writing', 'notes', 'google'],
    summary:
      'Your agent writes new documents with you, from meeting notes to client proposals. It can read any doc you point it at and edit it in place, so the result is ready to share.',
    examples: [
      'Summarize my most recent Google Doc',
      'Proofread my latest Google Doc',
      'Draft a client proposal outline in Google Docs',
    ],
    websiteUrl: 'https://docs.google.com',
  },
  googlesheets: {
    slug: 'googlesheets',
    name: 'Google Sheets',
    blurb: 'Read and update your spreadsheets',
    group: 'files-docs',
    tags: ['spreadsheets', 'data', 'numbers', 'google'],
    summary:
      'Your agent reads your spreadsheets and answers questions about the numbers in plain words. It can update cells, add rows, and start new sheets.',
    examples: [
      'Summarize my most recent Google Sheet',
      'Find monthly totals in my latest Google Sheet',
      'Start a Google Sheet to track my expenses',
    ],
    websiteUrl: 'https://sheets.google.com',
  },
  googleslides: {
    slug: 'googleslides',
    name: 'Google Slides',
    blurb: 'Build and update slide decks',
    group: 'files-docs',
    tags: ['slides', 'presentations', 'decks', 'google'],
    summary:
      'Your agent builds new slide decks from your notes and adds slides to decks you already have. It can read a deck and update the text on any slide. You finish the design in Slides.',
    examples: [
      'Summarize my latest Google Slides deck',
      'Check my latest Google Slides deck for typos',
      'Draft a short Google Slides pitch for my business',
    ],
    websiteUrl: 'https://slides.google.com',
  },
  one_drive: {
    slug: 'one_drive',
    name: 'OneDrive',
    blurb: 'Search and save OneDrive files',
    group: 'files-docs',
    tags: ['files', 'storage', 'documents', 'microsoft'],
    summary:
      'Your agent finds files in your OneDrive, reads them, and answers questions about what is inside. It can save new files to your folders.',
    examples: [
      'What changed in my OneDrive this week?',
      'Find my latest invoice in OneDrive',
      'Summarize the newest file in my OneDrive',
    ],
    websiteUrl: 'https://onedrive.live.com',
  },
  dropbox: {
    slug: 'dropbox',
    name: 'Dropbox',
    blurb: 'Search and organize your Dropbox',
    group: 'files-docs',
    tags: ['files', 'storage', 'sharing'],
    summary:
      'Your agent searches your Dropbox, reads files, and answers questions about them. It can upload new files and put them in the right folder.',
    examples: [
      'What did I add to Dropbox this week?',
      'Find my latest contract in Dropbox',
      'Which Dropbox files did I share recently?',
    ],
    websiteUrl: 'https://www.dropbox.com',
  },
  notion: {
    slug: 'notion',
    name: 'Notion',
    blurb: 'Search and update your Notion pages',
    group: 'files-docs',
    tags: ['notes', 'wiki', 'documents', 'database'],
    summary:
      'Your agent searches your Notion pages and databases and answers from what it finds. It can create pages, add to the ones you have, and look up records in a database.',
    examples: [
      'Summarize what changed in Notion this week',
      'Find my latest meeting notes in Notion',
      'Add a to-do list for this week in Notion',
    ],
    websiteUrl: 'https://www.notion.so',
  },
  stripe: {
    slug: 'stripe',
    name: 'Stripe',
    blurb: 'Check payments, customers, and invoices',
    group: 'money-crm',
    tags: ['payments', 'invoices', 'billing', 'revenue'],
    summary:
      'Your agent checks payments, customers, and invoices in your Stripe account and answers in plain numbers. It can also create invoices for you.',
    examples: [
      'How much did I earn on Stripe this month?',
      'Which Stripe payments failed this week?',
      'Who are my top Stripe customers this year?',
    ],
    websiteUrl: 'https://stripe.com',
  },
  square: {
    slug: 'square',
    name: 'Square',
    blurb: 'Track sales and orders in Square',
    group: 'money-crm',
    tags: ['payments', 'orders', 'pos', 'store'],
    summary:
      'Your agent checks sales, orders, and customers in your Square account. It tells you how any day went and finds single orders.',
    examples: [
      'How were my Square sales this week?',
      'What sold best on Square this month?',
      'Compare this month’s Square sales to last month',
    ],
    websiteUrl: 'https://squareup.com',
  },
  hubspot: {
    slug: 'hubspot',
    name: 'HubSpot',
    blurb: 'Look up contacts and track deals',
    group: 'money-crm',
    tags: ['crm', 'contacts', 'deals', 'sales'],
    summary:
      'Your agent looks up contacts, searches deals in your pipeline, and adds new contacts. It tells you where each deal stands without you opening HubSpot.',
    examples: [
      'Which HubSpot deals close this month?',
      'Summarize my open HubSpot deals by stage',
      'Which HubSpot contacts did I add this week?',
    ],
    websiteUrl: 'https://www.hubspot.com',
  },
  quickbooks: {
    slug: 'quickbooks',
    name: 'QuickBooks',
    blurb: 'Keep your books and invoices current',
    group: 'money-crm',
    tags: ['accounting', 'invoices', 'expenses', 'bookkeeping'],
    summary:
      'Your agent looks up invoices, customers, and payments in QuickBooks. It can create invoices and pull reports such as profit and loss.',
    examples: [
      'Which QuickBooks invoices are overdue?',
      'What did I spend most on in QuickBooks this month?',
      'How is my profit this quarter in QuickBooks?',
    ],
    websiteUrl: 'https://quickbooks.intuit.com',
  },
  facebook: {
    slug: 'facebook',
    name: 'Facebook Pages',
    blurb: 'Publish and manage your Page posts',
    group: 'marketing-social',
    tags: ['social', 'pages', 'posts', 'marketing'],
    summary:
      'Your agent publishes posts to your Facebook Page and checks how they do. It reads comments so you can keep up with replies.',
    examples: [
      'Which Facebook Page posts did best this month?',
      'Summarize new comments on my Facebook Page',
      'Draft a Facebook Page post about my latest work',
    ],
    websiteUrl: 'https://www.facebook.com',
  },
  instagram: {
    slug: 'instagram',
    name: 'Instagram',
    blurb: 'Post to Instagram and check results',
    group: 'marketing-social',
    tags: ['social', 'posts', 'photos', 'marketing'],
    summary:
      'Your agent publishes posts to your Instagram account and checks how recent ones did. It reads comments so you know what people are saying.',
    examples: [
      'How did my last five Instagram posts do?',
      'Summarize new comments on my Instagram posts',
      'Which Instagram posts got the most saves?',
    ],
    websiteUrl: 'https://www.instagram.com',
  },
  linkedin: {
    slug: 'linkedin',
    name: 'LinkedIn',
    blurb: 'Draft and share LinkedIn posts',
    group: 'marketing-social',
    tags: ['social', 'posts', 'professional', 'network'],
    summary:
      'Your agent drafts LinkedIn posts from your wins, launches, and lessons. It shares them from your profile when you say so.',
    examples: [
      'Draft a LinkedIn post about my latest project',
      'Rewrite my notes as a short LinkedIn post',
      'Share my latest blog post on LinkedIn',
    ],
    websiteUrl: 'https://www.linkedin.com',
  },
  youtube: {
    slug: 'youtube',
    name: 'YouTube',
    blurb: 'Search videos and check channel stats',
    group: 'marketing-social',
    tags: ['video', 'channel', 'social', 'content'],
    summary:
      'Your agent searches YouTube and pulls details and stats for videos and channels. It tells you how your recent uploads are doing.',
    examples: [
      'How did my last three YouTube videos do?',
      'Which YouTube video got the most views this year?',
      'Summarize the comments on my latest YouTube video',
    ],
    websiteUrl: 'https://www.youtube.com',
  },
  mailchimp: {
    slug: 'mailchimp',
    name: 'Mailchimp',
    blurb: 'Draft campaigns and manage your audience',
    group: 'marketing-social',
    tags: ['email', 'newsletter', 'campaigns', 'marketing'],
    summary:
      'Your agent drafts email campaigns and keeps your audience lists tidy. It reports how past campaigns did, such as opens and clicks.',
    examples: [
      'How did my last Mailchimp campaign do?',
      'How many Mailchimp subscribers joined this month?',
      'Draft a Mailchimp newsletter recapping this month',
    ],
    websiteUrl: 'https://mailchimp.com',
  },
  canva: {
    slug: 'canva',
    name: 'Canva',
    blurb: 'Find designs and start new ones',
    group: 'marketing-social',
    tags: ['design', 'graphics', 'social', 'creative'],
    summary:
      'Your agent finds designs in your Canva account and starts new blank ones at the size you need. You finish the design in Canva.',
    examples: [
      'Show my most recent Canva designs',
      'Find my Canva templates for social posts',
      'Export my latest Canva design as a PDF',
    ],
    websiteUrl: 'https://www.canva.com',
  },
};

// Derived from the allowlist, so the Apps tab can never drift from what the proxy enables.
export const ENABLED_TOOLKITS: readonly ToolkitMeta[] = COMPOSIO_TOOLKIT_ALLOWLIST.map(
  (slug) => TOOLKIT_METADATA[slug],
);

// Static CDN URLs render before connection reads; next/image allows only this host,
// and IntegrationLogo falls back to a monogram on load failure.
const COMPOSIO_LOGO_CDN_HOST = 'logos.composio.dev';

export function toolkitLogoUrl(slug: string): string {
  return `https://${COMPOSIO_LOGO_CDN_HOST}/api/${slug}`;
}

export function toolkitMetadata(slug: string): ToolkitMeta | undefined {
  return Object.values(TOOLKIT_METADATA).find((toolkit) => toolkit.slug === slug);
}
