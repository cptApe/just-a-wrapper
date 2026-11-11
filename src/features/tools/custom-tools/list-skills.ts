import 'server-only';
import { z } from 'zod';
import { listCustomSkillsForWorkspace } from '@/features/skills/server';
import { LIST_SKILLS_DECL } from '@/features/tool-catalog/skill-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';

const input = z.object({
  query: z.string().trim().min(1).max(120).optional(),
});
const output = z.object({
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});

export const listSkillsTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...LIST_SKILLS_DECL,
  inputSchema: input,
  outputSchema: output,
  async handler({ query }, ctx) {
    const skills = await listCustomSkillsForWorkspace({ workspaceId: ctx.workspaceId, query });
    return {
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        updatedAt: skill.updatedAt,
      })),
    };
  },
};
