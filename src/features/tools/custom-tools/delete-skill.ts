import 'server-only';
import { z } from 'zod';
import { deleteCustomSkillByName } from '@/features/skills/server';
import { DELETE_SKILL_DECL } from '@/features/tool-catalog/skill-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';

const input = z.object({
  name: z.string().trim().min(1).max(120),
});
const output = z.object({
  deleted: z.literal(true),
  name: z.string(),
});

export const deleteSkillTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...DELETE_SKILL_DECL,
  inputSchema: input,
  outputSchema: output,
  async handler({ name }, ctx) {
    await deleteCustomSkillByName({ workspaceId: ctx.workspaceId, name });
    return { deleted: true, name };
  },
};
