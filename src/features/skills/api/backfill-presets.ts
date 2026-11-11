import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { PRESET_SKILLS } from '../constants';
import { buildPresetBackfillEntries } from '../lib/preset-retirement';
import type { PresetBackfillEntry, PresetPushState } from '../types';
import { ensurePresetSkills } from './preset-skills';

// One pass updates global presets for every workspace; retired rows are reported, never mutated.
// `pnpm skills:backfill` runs it; it requires a key rather than accepting the provisioning skip.
export async function backfillPresetSkills(): Promise<PresetBackfillEntry[]> {
  requireAnthropicClient();

  const before = await snapshotPresetRows();
  await ensurePresetSkills();
  const after = await snapshotPresetRows();

  return buildPresetBackfillEntries({ registry: PRESET_SKILLS, before, after });
}

async function snapshotPresetRows(): Promise<Map<string, NonNullable<PresetPushState>>> {
  const rows = await db
    .select({
      name: skill.name,
      anthropicSkillId: skill.anthropicSkillId,
      latestVersion: skill.latestVersion,
      sourceHash: skill.sourceHash,
    })
    .from(skill)
    .where(and(isNull(skill.ownerWorkspaceId), eq(skill.kind, 'preset')));
  return new Map(
    rows.map((row) => [
      row.name,
      {
        anthropicSkillId: row.anthropicSkillId,
        latestVersion: row.latestVersion,
        sourceHash: row.sourceHash,
      },
    ]),
  );
}
