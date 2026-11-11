import { type AdminPrompt, formatAdminPrompt } from '@/lib/admin-prompt';
import { COMPOSIO_TOOLKIT_ALLOWLIST, ENABLED_TOOLKITS } from '@/lib/composio/toolkits';

const ENABLED_TOOLKIT_COUNT = COMPOSIO_TOOLKIT_ALLOWLIST.length;

export const COMPOSIO_TOOLKIT_DIRECTORY_URL = 'https://docs.composio.dev/toolkits';

export const INTEGRATIONS_ADMIN_PROMPT: AdminPrompt = {
  where:
    'src/lib/composio/toolkits.ts, in COMPOSIO_TOOLKIT_ALLOWLIST and TOOLKIT_METADATA; and src/features/integrations/data/composio-tool-allowlist.json for the approved actions',
  what: `Add <app> to the ${ENABLED_TOOLKIT_COUNT} apps this product supports now. Add its lowercase Composio slug to COMPOSIO_TOOLKIT_ALLOWLIST. Add its customer-facing name, one-line description, group, search tags, two or three sentence summary, three example requests, and https website URL to TOOLKIT_METADATA. Review every action Composio lists for the new app, then add the action slugs you approve under the app's slug in composio-tool-allowlist.json.`,
  guardrails: [
    `Check ${COMPOSIO_TOOLKIT_DIRECTORY_URL} before changing the files. Confirm the app exists and that Composio handles customer sign-in for it.`,
    'Keep the Composio slug lowercase. Keep the one-line description to 5 or 6 plain words, start it with a verb, and do not end it with a period.',
    'Write the summary and examples for customers. Use plain words, concrete requests a small business owner would type, no API language, and no em dashes.',
    'Every allowed app needs a list in composio-tool-allowlist.json, or the type check fails. Keep only actions customers should be able to run.',
    'Run pnpm composio:remint after the change so existing customers can see the new app.',
    'Do not add or show secret values.',
  ],
  verify: [
    'pnpm validate:config',
    'pnpm verify',
    'Open /app/tools and confirm the app appears with its logo, name, and one-line description',
  ],
};

function appsTable(): string {
  return [
    '| App | What customers can do |',
    '| --- | --- |',
    ...ENABLED_TOOLKITS.map((toolkit) => `| ${toolkit.name} | ${toolkit.blurb} |`),
  ].join('\n');
}

export function integrationsAdminMarkdown(): string {
  return [
    '# Integrations',
    '## Browse and add',
    '### Composio',
    'Composio is the integration partner that connects your product to hundreds of apps. The kit uses one partner so customers can connect their tools safely without you building every connection yourself.',
    `[Browse 1000+ apps](${COMPOSIO_TOOLKIT_DIRECTORY_URL})`,
    '### Add an app with your agent',
    formatAdminPrompt(INTEGRATIONS_ADMIN_PROMPT),
    '## Apps your product supports',
    'Your customers connect these from their Tools page. Every action asks permission before it runs.',
    appsTable(),
  ].join('\n\n');
}
