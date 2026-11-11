// The `no-restricted-syntax` entries for src/. Flat config does not merge this rule across blocks,
// so eslint.config.mjs builds each block's list from these named groups, and
// tests/eslint-rules/restricted-syntax.test.mjs runs every group against real code samples.
// esquery ends a regex at the first `/`, so a slash inside a pattern is written \x2F.

const fetchMessage =
  'Use fetchJson from @/lib/fetch-json for JSON /api calls; raw fetch only for streams/blobs/status-probe contracts (add an eslint-disable with the reason).';

/** JSON calls go through fetchJson. */
export const RAW_API_FETCH = [
  {
    selector: "CallExpression[callee.name='fetch'] > Literal[value=/^\\/api\\//]:first-child",
    message: fetchMessage,
  },
  {
    selector:
      "CallExpression[callee.name='fetch'] > TemplateLiteral:first-child[quasis.0.value.raw=/^\\/api\\//]",
    message: fetchMessage,
  },
];

/** Analytics capture funnel: `posthog.capture(...)` but not `posthog.captureException(...)`. */
export const RAW_POSTHOG_CAPTURE = [
  {
    selector: "CallExpression[callee.object.name='posthog'][callee.property.name='capture']",
    message:
      'Raw posthog.capture() is banned. Use captureEvent() from @/lib/analytics (server) or @/lib/analytics-client (client) with a registered ANALYTICS_EVENTS name (10-analytics-events §2).',
  },
];

const durationClass = '/(^|\\s)duration-\\d+(\\s|$)/';

/** A duration-* utility also starts a transition, so an anchored panel would slide after it opens. */
export const FLOATING_PANEL_TRANSITION = [
  {
    selector: `:matches(VariableDeclarator, FunctionDeclaration)[id.name=/^(DropdownMenu|Popover|Select|Tooltip)Content$/] :matches(Literal[value=${durationClass}], TemplateElement[value.raw=${durationClass}])`,
    message:
      'Floating panels time their animation with animation-duration-*; duration-* also starts a transition, so the panel moves after it opens.',
  },
];

const upgradePage = '/(^|[^\\w.\\x2F-])\\x2Fupgrade(?![\\w-])|Get the repo/';

/** Plans are chosen in the plan dialog (decision 0047); /upgrade only redirects to the app. */
export const NO_UPGRADE_PAGE = [
  {
    selector: `:matches(Literal[value=${upgradePage}], TemplateElement[value.raw=${upgradePage}], JSXText[value=${upgradePage}])`,
    message:
      "There is no /upgrade page. Open the plan dialog with openOverlay('plans'), or link to Billing (/app/settings/billing).",
  },
];

/** The Tools page reads only tab, q and status; ?source= and ?perm= are retired facets. */
export const RETIRED_TOOLS_FACETS = [
  {
    selector: "CallExpression[callee.name='useQueryState'][arguments.0.value=/^(perm|source)$/]",
    message:
      'The Tools page has no source or permission facet; use toolsParsers from @/lib/tools-search-params.',
  },
];

// Migration SQL is the shipped artifact a backfill test replays, not source text.
const srcPath = '/(^|\\x2F)src(\\x2F(?!db\\x2Fmigrations)|$)/';
const sourceTextMessage =
  'Tests check behaviour, not source text: import the module, render it, or call it (docs/spec/01-code-standard.md section 8).';

/** A test may not read a file under src/ as text; the loaders that compile src/ are exempt in eslint.config.mjs. */
export const SOURCE_TEXT_IN_TESTS = [
  {
    selector: `CallExpression:matches([callee.name=/^(readFile|readdir)(Sync)?$/], [callee.property.name=/^(readFile|readdir)(Sync)?$/]) :matches(Literal[value=${srcPath}], TemplateElement[value.raw=${srcPath}])`,
    message: sourceTextMessage,
  },
];

/** The only app modules an integration test may replace (decision 0012); everything else runs for real. */
export const INTEGRATION_SEAMS = [
  // Configuration and the signed-in browser session, faked only through helpers/seams.ts.
  '@/lib/env',
  '@/lib/auth',
  // Operator pricing, which a fork edits like configuration; faked only through helpers/seams.ts.
  '@/features/billing/pricing-config',
  // Telemetry: PostHog analytics and error capture.
  '@/lib/analytics',
  '@/lib/observability',
  // Provider clients, each a thin wrapper over network calls.
  '@/lib/stripe',
  '@/features/agents',
  '@/features/agents/api/anthropic-client',
  '@/features/files/api/import-drive-file',
  '@/features/integrations/composio/connect',
  '@/features/integrations/composio/disconnect',
  '@/features/integrations/mcp-proxy-client',
  '@/features/tasks/api/composio-triggers',
  '@/features/tools/api/browserbase-client',
  '@/features/tools/api/session-output',
  '@/features/tools/lib/gateway-image',
  '@/features/voice/api/transcribe-audio',
  '@/features/voice/server',
];

const seamPattern = `/^(${INTEGRATION_SEAMS.map((name) =>
  name.replaceAll('/', '\\x2F').replaceAll('.', '\\.').replaceAll('-', '\\-'),
).join('|')})$/`;
const viMock = "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock)$/]";

/** Integration tests run app code on the real test database and replace only the seams above. */
export const INTEGRATION_MOCKS = [
  {
    selector: `${viMock}[arguments.0.value='@/db']`,
    message:
      'Integration tests use the real test database: import db from @/db instead of mocking it (decision 0012).',
  },
  {
    selector: `${viMock}[arguments.0.value=/^@\\x2F/][arguments.0.value!='@/db'][arguments.0.value!=${seamPattern}]`,
    message:
      'Run this module for real on seeded rows. An integration test replaces only the seams in INTEGRATION_SEAMS (eslint-rules/restricted-syntax.mjs, decision 0012).',
  },
];
