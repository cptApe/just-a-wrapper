import { headers } from 'next/headers';
import { z } from 'zod';
import {
  createCustomSkill,
  listSkillsForWorkspace,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_FILES,
} from '@/features/skills/server';
import { resolveCaller } from '@/lib/caller';
import { parseJsonBody, withApiRoute } from '@/lib/route-kit';
export const runtime = 'nodejs';
const SkillBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        content: z.string().max(MAX_SKILL_FILE_BYTES),
      }),
    )
    .min(1)
    .max(MAX_SKILL_FILES),
});

export const GET = withApiRoute({ route: 'api/skills' }, async () => {
  const { workspaceId } = await resolveCaller(await headers());
  return Response.json({ skills: await listSkillsForWorkspace({ workspaceId }) });
});
export const POST = withApiRoute({ route: 'api/skills' }, async (request) => {
  const { workspaceId, userId } = await resolveCaller(await headers());
  const input = await parseJsonBody(request, SkillBody);
  const skill = await createCustomSkill({ workspaceId, userId, ...input });
  return Response.json({ skill }, { status: 201 });
});
