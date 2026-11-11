import { PRESET_SKILLS } from '../constants';
import type { PresetBackfillEntry, PresetPushState, SkillKind } from '../types';

const ACTIVE_PRESET_NAMES: ReadonlySet<string> = new Set(
  PRESET_SKILLS.map((preset) => preset.name),
);

// Global preset rows absent from the registry stay stored but are hidden from
// lists and new sessions.
export function isRetiredPresetRow(row: { kind: SkillKind; name: string }): boolean {
  return row.kind === 'preset' && !ACTIVE_PRESET_NAMES.has(row.name);
}

export function buildPresetBackfillEntries(input: {
  registry: readonly { name: string }[];
  before: ReadonlyMap<string, NonNullable<PresetPushState>>;
  after: ReadonlyMap<string, NonNullable<PresetPushState>>;
}): PresetBackfillEntry[] {
  const registryNames = new Set(input.registry.map((preset) => preset.name));
  const active = input.registry.map((preset): PresetBackfillEntry => {
    const before = input.before.get(preset.name) ?? null;
    const after = input.after.get(preset.name) ?? null;
    return {
      name: preset.name,
      before,
      after,
      repushed:
        before?.latestVersion !== after?.latestVersion || before?.sourceHash !== after?.sourceHash,
      retired: false,
    };
  });
  const retired = [...input.after.entries()]
    .filter(([name]) => !registryNames.has(name))
    .map(
      ([name, state]): PresetBackfillEntry => ({
        name,
        before: input.before.get(name) ?? null,
        after: state,
        repushed: false,
        retired: true,
      }),
    );
  return [...active, ...retired];
}
