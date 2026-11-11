import { z } from 'zod';
import { SKILL_KINDS, SKILL_STATUSES } from '@/db/schema/skill-kinds';
import { AppError } from '@/lib/errors';

export const skillFileSchema = z.object({ path: z.string(), content: z.string() });
// isPreset drives the badge and read-only handling.
// canEdit restricts chat edits and deletion to workspace customs.
export const skillListItemSchema = z.object({
  id: z.string(),
  status: z.enum(SKILL_STATUSES),
  anthropicSkillId: z.string().nullable(),
  kind: z.enum(SKILL_KINDS),
  name: z.string(),
  description: z.string().nullable(),
  latestVersion: z.string().nullable(),
  isPreset: z.boolean(),
  canEdit: z.boolean(),
  connections: z.array(z.string()),
  fileCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const skillDetailSchema = skillListItemSchema.extend({ files: z.array(skillFileSchema) });
const listResponse = z.object({ skills: z.array(skillListItemSchema) });
const createResponse = z.object({ skill: skillListItemSchema });
const detailResponse = z.object({ skill: skillDetailSchema });

function parseResponse<T>(payload: unknown, schema: z.ZodType<T>, operation: string): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(
      'API_REQUEST_FAILED',
      `Skill ${operation} returned an invalid response.`,
      { operation, issues: parsed.error.issues },
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
export function parseSkillsResponse(payload: unknown) {
  return parseResponse(payload, listResponse, 'list').skills;
}
export function parseCreatedSkillResponse(payload: unknown) {
  return parseResponse(payload, createResponse, 'create').skill;
}
export function parseSkillDetailResponse(payload: unknown) {
  return parseResponse(payload, detailResponse, 'detail').skill;
}
