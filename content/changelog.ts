/**
 * The kit's release history, written for the person running a fork.
 *
 * This file lives in `content/` for the same reason `brand.ts` does: it is
 * upstream's writing about upstream's work, and a fork inherits it by pulling
 * it in rather than by editing it. Notes are plain sentences about what changed
 * and why it matters to someone running this software, not commit messages.
 *
 * `KIT_VERSION` is the newest entry's version, and `package.json` carries the
 * same number. In this repo the two are always equal, because this repo IS
 * upstream. In a fork they diverge the moment upstream files are pulled in
 * ahead of the fork's own version bump, and that gap is what lights the badge
 * on the Updates row (see `upstreamAhead`).
 *
 * Kept dependency-free so a client component can import it.
 */

export type KitRelease = {
  /** major.minor.patch. */
  version: string;
  /** ISO date of the day the release's work closed. */
  date: string;
  /** One plain line naming what the release was about. */
  title: string;
  /** Operator-facing change notes, most consequential first. */
  notes: readonly string[];
  /** The config surfaces and features a merge of this release touches. */
  areas: readonly string[];
};

/** Newest first. */
export const KIT_CHANGELOG: readonly [KitRelease, ...KitRelease[]] = [
  {
    version: '1.0.0',
    date: '2026-11-11',
    title: 'Open source',
    notes: [
      'The first public release under the MIT licence.',
      'Billing has two modes. Subscriptions with plans are the default; prepaid credits at API cost are an add-on in their own folder. Switch with BILLING_MODE or in the admin console.',
      'Your brand and contact details come from configuration: set NEXT_PUBLIC_BRAND_NAME, NEXT_PUBLIC_APP_URL and SUPPORT_EMAIL. A deployment refuses to build until they are set.',
      'Credits are charged once per session from exact provider cost, so small requests no longer round up to a whole credit.',
      'The app runs against a local Postgres in Docker, so a Neon account is optional for development.',
    ],
    areas: ['billing', 'brand', 'pricing'],
  },
  {
    version: '0.6.0',
    date: '2026-08-31',
    title: 'A polished console and a smoother chat',
    notes: [
      'Advisor toggle removed.',
      'Every admin page now speaks one language: short verb buttons that copy instructions for your coding agent, a toast confirming each copy, one section and banner style, and a Source files footnote so an agent knows exactly which file each page reads.',
      'The Overview keeps its setup list visible after everything is done, explains each check in plain words, and adds two reference blocks: where every setting lives, and what your app is built on, with links to each service.',
      'Theme editing is fully named: eight colors per mode, corner sizes as words, a real font list, and a cascade that keeps text readable no matter what you pick. The raw values sit behind one collapsed All tokens list.',
      'The agent personality reads as one document per plan, shown exactly as sent. The Updates page shows your version honestly, marks releases you already have, and only offers updates when there are any.',
      'Chat history loads in one fetch, thumbs-up and thumbs-down only save when you press Send, the task header shows which plan a task runs on, and the chat composer can attach library files and skills just like the home screen.',
      'The top plan is now called Expert. Keyboard focus rings paint on every button.',
    ],
    areas: ['admin', 'chat', 'agents', 'theme', 'pricing'],
  },
  {
    version: '0.5.0',
    date: '2026-08-20',
    title: 'An operator console for your fork',
    notes: [
      'The admin console at /admin is new. It reads the configuration files in your own checkout and lays out, page by page, what this fork is set up to be. It is off until you set NEXT_PUBLIC_ENABLE_ADMIN_ROUTES=true, so a checkout without that flag answers 404 at /admin.',
      'The top tier runs Opus 5.',
      "The middle tier was repriced against Sonnet 5's real token rates. The rule for changing any tier's model or price is written at the top of the agent config, so nobody has to guess what else moves with it.",
      'New chats approve tool use as they go. Anthropic still stops anything that genuinely needs a person to look at it.',
      'The short sentences the agent writes between tool calls now fold into the running list of steps it shows while it works, instead of piling up as separate messages.',
    ],
    areas: ['admin', 'agents', 'pricing', 'permissions', 'chat'],
  },
  {
    version: '0.4.0',
    date: '2026-08-19',
    title: 'The kit becomes something you can hand over',
    notes: [
      'One file names the product. The product name, slug, domain, and support address all come from content/brand.ts, and nothing left in the codebase is written for one particular industry.',
      'Billing was rebuilt: three plans, two of them on monthly or yearly terms, a ledger that records every credit granted and spent, a daily allowance for free accounts, per-member limits, and top-ups. Every number sits in one pricing file.',
      'Four skills let a coding agent rebrand, restyle, reprice, or change the bundled skill pack for you, and there is one entry point that sends it to the right one.',
      'A documentation site ships with the product, including an honest chapter on what a run actually costs to serve.',
      'Six quality suites you can run yourself, with a README that tells you what each one spends before you start it.',
      'A scheduled task can carry a plain-language success criterion. The platform grades the run against it, and a failed grade is never confused with a run that could not be graded at all.',
      'Every session now carries a spending cap worked out from the workspace balance, so a single runaway task cannot empty an account.',
      'Tool permissions moved out of the composer. There is no permission mode to pick before a chat starts. When the agent asks for a tool you approve it once, always for that task, or always everywhere, and the docs chapter on tools spells out who controls what.',
      'The design system is documented as it was actually built, and the token editor at /admin/theme lets you edit it live and copy the result back out.',
    ],
    areas: ['brand', 'billing', 'pricing', 'permissions', 'docs', 'skills', 'theme', 'scheduled'],
  },
  {
    version: '0.3.0',
    date: '2026-07-10',
    title: 'Teams, and an app that stops making you wait',
    notes: [
      'Tasks belong to whoever started them. Sharing one with the team is a deliberate act, and once it is shared, teammates can write into the same thread.',
      'The Library has a Team folder, shared tasks show who else is looking at them, and a daily pulse tells the team what happened.',
      'Every list in the app is cached on the client, so moving between Scheduled, Skills, Library, and Memory is instant instead of a fresh wait each time.',
      'The agent can generate images and video. Both land in the Library and are metered like everything else it does.',
      'When the agent browses a page it keeps a snapshot, so you can see the page it actually read.',
      'The app works on a phone: one header per page, actions you can reach with a thumb, and a composer where return makes a new line and the button sends.',
      'A page that breaks says what broke instead of going white.',
      'A guided first session sets the agent up with what it needs to know about you.',
    ],
    areas: ['teams', 'library', 'performance', 'tools', 'mobile', 'onboarding'],
  },
  {
    version: '0.2.0',
    date: '2026-07-05',
    title: 'Every surface gets its real shape',
    notes: [
      'Every view has an address, dialogs and overlays included, so a link reopens exactly what you were looking at.',
      'Library, Tools, and Scheduled were rebuilt on one file browser and one toolbar, so all three behave the same way.',
      'Tool results render as readable cards in plain wording instead of raw output, and a gallery page shows every one of them side by side.',
      'Files the agent produces open in a panel beside the thread that you can move and resize.',
      'Settings became a real section: account, workspace, members, notifications, usage with a CSV export, and billing history with receipts.',
      'Loading states are shaped like the page they precede, so nothing jumps when the content lands.',
      'Search reaches everything, from the sidebar or the command menu.',
      'The agent can search the web and read the pages it finds.',
    ],
    areas: ['navigation', 'library', 'tools', 'settings', 'chat'],
  },
  {
    version: '0.1.0',
    date: '2026-06-16',
    title: 'The foundation this kit starts from',
    notes: [
      'Sign in with an email code or with Google. A new account is provisioned into its own workspace on first login.',
      "The agent runs on Anthropic's Managed Agents, so sessions, memory stores, and skills live on Anthropic's infrastructure.",
      'Replies stream as they are written, with markdown, syntax-highlighted code, and formulas rendered properly.',
      'Files, memory, and skills each got a home, and the agent can read them while it works.',
      'Tasks can run on a schedule or be started by an event.',
      'Connected apps go through Composio, and each tool can be allowed, blocked, or held for approval.',
      'Billing on Stripe: subscriptions, credit grants, top-ups, usage accrual, and a session that pauses rather than overspending.',
      'Notifications in the app and by email.',
      'The design language landed: tokens, primitives, the sidebar, and one icon set across the whole app.',
    ],
    areas: ['auth', 'agents', 'chat', 'billing', 'integrations', 'design system'],
  },
];

/** The version of the newest release above. `package.json` carries the same number. */
export const KIT_VERSION: string = KIT_CHANGELOG[0].version;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version: string): [number, number, number] | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when a fork version can be compared with the release changelog. */
export function canReadVersion(forkVersion: string): boolean {
  return parseVersion(forkVersion) !== null;
}

/**
 * True when `kitVersion` names a release newer than `forkVersion`, which is
 * exactly the condition the Updates badge reports. Upstream always answers
 * false, because upstream ships the bump and the entry together.
 *
 * Anything that is not major.minor.patch answers false rather than throwing.
 * This runs inside the client nav on every admin route, so a fork with an
 * unparseable version in its package.json must still get a working console:
 * the badge stays dark and the pages render.
 */
export function upstreamAhead(forkVersion: string, kitVersion: string = KIT_VERSION): boolean {
  const fork = parseVersion(forkVersion);
  const kit = parseVersion(kitVersion);
  if (!fork || !kit) return false;
  for (let index = 0; index < 3; index += 1) {
    const kitPart = kit.at(index);
    const forkPart = fork.at(index);
    if (kitPart !== undefined && forkPart !== undefined && kitPart !== forkPart)
      return kitPart > forkPart;
  }
  return false;
}

/** True when this release must still be applied to the fork. */
export function isReleaseNewerThanFork(release: KitRelease, forkVersion: string): boolean {
  return upstreamAhead(forkVersion, release.version);
}
