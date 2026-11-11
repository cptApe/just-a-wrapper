'use server';

import { headers } from 'next/headers';
import { classifyToolAccess } from '@/features/permissions/lib/classify';
import { resolveUser } from '@/lib/caller';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { listToolkitTools } from '@/lib/composio/toolkit-tools';
import { toolkitMetadata } from '@/lib/composio/toolkits';
import { captureException } from '@/lib/observability';
import { withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import { capabilityPhrase, describeAction, isCuratedAction } from '../lib/capabilities';
import type { IntegrationActionsResult, IntegrationActionView } from '../types';

// Server action backing the integration detail modal: one toolkit's action
// list, phrased for humans (lib/capabilities.ts), curated actions first so the
// capabilities summary leads with what people actually use. Signed-in members
// only — the list is catalog metadata, but it is served through OUR Composio
// key and is not an anonymous endpoint.

export async function getIntegrationActions(slug: string): Promise<IntegrationActionsResult> {
  return withRequestContext(
    { route: 'plugins/connectors/actions', feature: 'integrations' },
    async () => {
      const meta = toolkitMetadata(slug);
      if (!meta) {
        return {
          status: 'notice',
          notice: {
            tone: 'error',
            title: 'Unknown integration',
            body: `No such integration: ${slug}`,
          },
        };
      }
      const { connectedApps } = capabilities;
      if (connectedApps.kind === 'off') {
        return {
          status: 'notice',
          notice: {
            tone: 'warn',
            title: 'Connected apps are off',
            body: CAPABILITY_OFF_MESSAGES.connectedApps,
          },
        };
      }
      await resolveUser(await headers());

      try {
        const { tools, totalCount } = await listToolkitTools(meta.slug, connectedApps.apiKey);
        const actions: IntegrationActionView[] = tools
          .map((tool) => {
            const phrase = capabilityPhrase(tool.slug, tool.name);
            const description = describeAction(tool.description);
            return {
              slug: tool.slug,
              phrase,
              // A description that just restates the phrase is noise, not meta.
              description: description.toLowerCase() === phrase.toLowerCase() ? '' : description,
              curated: isCuratedAction(tool.slug),
              access: classifyToolAccess(tool.slug, tool.tags),
            };
          })
          .sort((a, b) => Number(b.curated) - Number(a.curated));
        return { status: 'ok', actions, totalCount };
      } catch (error) {
        captureException(error, { op: 'integration-actions', toolkitSlug: slug });
        return {
          status: 'notice',
          notice: {
            tone: 'error',
            title: 'Couldn’t load actions',
            body: 'Reading this integration’s actions didn’t go through. Close and try again.',
          },
        };
      }
    },
  );
}
