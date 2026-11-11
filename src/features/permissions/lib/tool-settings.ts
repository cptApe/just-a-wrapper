import { z } from 'zod';

// Store per-tool generation quality alongside policy in tool_permission.settings.
// Keep definitions and parsing pure so UI, server actions, handlers and tests share them.

export const GENERATION_QUALITIES = ['low', 'mid', 'high'] as const;
export type GenerationQuality = (typeof GENERATION_QUALITIES)[number];

/** The product default when the user has chosen nothing (stays mid). */
export const DEFAULT_GENERATION_QUALITY: GenerationQuality = 'mid';

/** Human labels for the quality select. */
export const GENERATION_QUALITY_LABEL: Record<GenerationQuality, string> = {
  low: 'Low',
  mid: 'Mid',
  high: 'High',
};

/**
 * Tools whose default generation quality the user can set in the built-ins modal.
 * Both generation verbs support quality tiers (image, video — its
 * quality maps to a real Seedance resolution), so the stored default applies to
 * each identically.
 */
export const QUALITY_CONFIGURABLE_TOOLS: ReadonlySet<string> = new Set([
  'generate_image',
  'generate_video',
  'edit_image',
]);

// Validate writes strictly; malformed settings must throw rather than replace
// a stored value with an empty default.
export const ToolSettingsSchema = z.object({
  defaultQuality: z.enum(GENERATION_QUALITIES).optional(),
});

export type ToolSettings = z.infer<typeof ToolSettingsSchema>;

/**
 * Parse a value stored in the `tool_permission.settings` jsonb column. The
 * column can hold arbitrary prior/legacy JSON, so this is a READ-boundary parse
 * that degrades a malformed blob to "no default" ({}) rather than throwing at the
 * gate — a corrupt setting must never crash a generation or the settings load.
 * The write path uses the strict schema above; only reads tolerate garbage.
 */
export function parseStoredToolSettings(value: unknown): ToolSettings {
  const parsed = ToolSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/** Input schemas default omitted quality to mid, so handlers cannot distinguish
 * an explicit mid from an omitted value. Mid therefore uses the stored default;
 * explicit low or high wins. An explicit mid cannot override a stored non-mid default. */
export function resolveEffectiveQuality(
  requested: GenerationQuality,
  storedDefault: GenerationQuality | undefined,
): GenerationQuality {
  if (requested !== DEFAULT_GENERATION_QUALITY) return requested;
  return storedDefault ?? DEFAULT_GENERATION_QUALITY;
}
