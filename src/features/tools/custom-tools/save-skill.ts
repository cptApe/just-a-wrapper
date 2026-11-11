import 'server-only';
import { z } from 'zod';
import { MAX_SKILL_FILE_BYTES, MAX_SKILL_FILES } from '@/features/skills/lib/skill-files';
import { saveCustomSkill } from '@/features/skills/server';
import { SAVE_SKILL_DECL } from '@/features/tool-catalog/skill-declarations';
import type { CustomTool } from '@/features/tool-catalog/types';

const input = z.object({
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
  saved: z.literal(true),
  skillId: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

// Destructive (it can overwrite an existing custom skill), so ask-mode sessions
// route it through the persisted confirmation queue. The heavy lifting —
// folder validation, name-collision handling, the Anthropic push with version
// bump — is the skills feature's saveCustomSkill; full-folder rule violations
// surface as typed TOOL_INPUT_INVALID errors the dispatcher relays verbatim,
// so the agent can fix the folder and retry.
export const saveSkillTool: CustomTool<z.infer<typeof input>, z.infer<typeof output>> = {
  ...SAVE_SKILL_DECL,
  inputSchema: input,
  outputSchema: output,
  async handler({ name, description, files }, ctx) {
    const skill = await saveCustomSkill({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      name,
      description: description ?? null,
      files,
    });
    return { saved: true, skillId: skill.id, name: skill.name, version: skill.latestVersion };
  },
};
