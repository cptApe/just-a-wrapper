import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { PRESET_SKILLS } from '../constants';
import { presetContentHash, readPresetSkillFiles } from './preset-content';
import { claimPublication, finishPublication, reserveSkill } from './skill-transitions';

export async function ensurePresetSkills(): Promise<void> {
  if (!getAnthropicClient()) {
    captureException(
      new AppError('INTEGRATION_NOT_CONNECTED', 'Preset provisioning requires Anthropic', {}),
    );
    return;
  }
  for (const preset of PRESET_SKILLS) {
    const files = await readPresetSkillFiles(preset.contentDir);
    const hash = presetContentHash(files);
    const publication = {
      token: randomUUID(),
      name: preset.name,
      description: preset.description,
      directory: preset.directory,
      files,
      sourceHash: hash,
    };
    let existing = await findPresetRow(preset.name);
    if (!existing) {
      existing =
        (await reserveSkill({ kind: 'preset', name: preset.name }, publication)) ??
        (await findPresetRow(preset.name));
    }
    if (!existing)
      throw new AppError('CONFLICT', 'Preset reservation disappeared', { name: preset.name });
    const ready = await finishPublication(existing);
    if (ready.sourceHash === hash) continue;
    let claimed;
    try {
      claimed = await claimPublication(ready, publication);
    } catch (cause) {
      if (!(cause instanceof AppError) || cause.code !== 'CONFLICT') throw cause;
      const winner = await findPresetRow(preset.name);
      if (!winner) throw cause;
      const recovered = await finishPublication(winner);
      if (recovered.sourceHash === hash) continue;
      claimed = await claimPublication(recovered, publication);
    }
    await finishPublication(claimed);
  }
}

export async function arePresetSkillsProvisioned(): Promise<boolean> {
  if (!getAnthropicClient()) return false;
  for (const preset of PRESET_SKILLS) {
    const files = await readPresetSkillFiles(preset.contentDir);
    const existing = await findPresetRow(preset.name);
    if (
      !existing ||
      existing.status !== 'ready' ||
      !existing.anthropicSkillId ||
      !existing.latestVersion ||
      existing.sourceHash !== presetContentHash(files)
    )
      return false;
  }
  return true;
}

async function findPresetRow(name: string) {
  return (
    (
      await db
        .select()
        .from(skill)
        .where(and(isNull(skill.ownerWorkspaceId), eq(skill.kind, 'preset'), eq(skill.name, name)))
        .limit(1)
    ).at(0) ?? null
  );
}
