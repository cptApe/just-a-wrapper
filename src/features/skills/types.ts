import type { z } from 'zod';
import type { skillDetailSchema, skillFileSchema, skillListItemSchema } from './lib/skill-response';
export type SkillKind = SkillListItem['kind'];

/** The push state of one global preset row; null when the row does not exist. */
export type PresetPushState = {
  anthropicSkillId: string | null;
  latestVersion: string | null;
  sourceHash: string | null;
} | null;

// Preset backfill reports whether each registered preset was pushed.
// Unregistered global rows are reported separately and never modified by the pass.
export type PresetBackfillEntry = {
  name: string;
  before: PresetPushState;
  after: PresetPushState;
  repushed: boolean;
  retired: boolean;
};

export type SkillFileEntry = z.infer<typeof skillFileSchema>;
export type SkillListItem = z.infer<typeof skillListItemSchema>;
export type SkillDetail = z.infer<typeof skillDetailSchema>;

export type SkillUploadInput = {
  displayTitle: string;
  /** Anthropic upload directory — files land at `<directory>/<path>`. */
  directory: string;
  files: SkillFileEntry[];
};

export type SkillVersionUploadInput = {
  skillId: string;
  directory: string;
  files: SkillFileEntry[];
};

export type PushedSkill = {
  skillId: string;
  version: string;
};

// kind is the upstream resource kind: centrally owned presets attach as custom skills.
export type SkillSessionRef = {
  id: string;
  kind: 'anthropic' | 'custom';
  version?: string;
};
