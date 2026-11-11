import 'server-only';
import { z } from 'zod';
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_FILES } from '@/features/skills/lib/skill-files';
import { updateCustomSkillByName } from '@/features/skills/server';
import { UPDATE_SKILL_DECL } from '@/features/tool-catalog/skill-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';

const input = z.object({
  current_name: z.string().trim().min(1).max(120),
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
const output = z.object({
  updated: z.literal(true),
  skillId: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

export const updateSkillTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...UPDATE_SKILL_DECL,
  inputSchema: input,
  outputSchema: output,
  async handler({ current_name, name, description, files }, ctx) {
    const skill = await updateCustomSkillByName({
      workspaceId: ctx.workspaceId,
      currentName: current_name,
      name,
      description: description ?? null,
      files,
    });
    return { updated: true, skillId: skill.id, name: skill.name, version: skill.latestVersion };
  },
};
