import 'server-only';
import { insertDefaultMemberToolPermissions } from '@/features/permissions/api/tool-policy-transitions';
import { classifyToolAccess } from '@/features/permissions/lib/classify';
import { listToolkitTools } from '@/lib/composio/toolkit-tools';

/** Materialize tag-derived exact policies without overwriting member choices. */
export async function ensureConnectedAppToolDefaults(input: {
  organizationId: string;
  userId: string;
  toolkit: string;
  apiKey: string;
}): Promise<void> {
  const { tools } = await listToolkitTools(input.toolkit, input.apiKey);
  await insertDefaultMemberToolPermissions({
    organizationId: input.organizationId,
    userId: input.userId,
    tools: tools.map((tool) => ({
      toolkit: input.toolkit,
      toolName: tool.slug,
      access: classifyToolAccess(tool.slug, tool.tags),
    })),
  });
}
