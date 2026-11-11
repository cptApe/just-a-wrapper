// Editing happens in chat through save_skill, so this route has no PATCH.

import { headers } from 'next/headers';
import { z } from 'zod';
import { deleteCustomSkill, getSkillDetail } from '@/features/skills/server';
import { resolveCaller } from '@/lib/caller';
import { parseRouteParams, withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
const skillParams = z.object({ id: z.string() });
export const GET = withApiRoute({ route: 'api/skills/[id]' }, async (_request, context) => {
  const { workspaceId } = await resolveCaller(await headers());
  const { id } = await parseRouteParams(context.params, skillParams);
  return Response.json({ skill: await getSkillDetail({ workspaceId, skillId: id }) });
});
export const DELETE = withApiRoute({ route: 'api/skills/[id]' }, async (_request, context) => {
  const { workspaceId } = await resolveCaller(await headers());
  const { id } = await parseRouteParams(context.params, skillParams);
  await deleteCustomSkill({ workspaceId, skillId: id });
  return Response.json({ deleted: id });
});
