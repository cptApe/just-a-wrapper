import type { AdminPrompt } from '@/lib/admin-prompt';
import { THEME_SOURCE_PATH, THEME_TOKEN_GROUPS } from '../constants';
import type { ThemeTokenChange, ThemeTokenGroup } from '../types';

// Agent-ready prompts for the theme, in the one AdminPrompt shape every admin
// page hands to an agent. The edit card formats the per-session prompt (only
// the changed tokens); the admin page header formats the page-level prompt.

const GUARDRAILS = [
  `${THEME_SOURCE_PATH} is the theme source of truth`,
  'Keep the :root / .dark / @theme inline structure: light values in :root, dark overrides in .dark, --text-* type tokens in @theme inline',
];

const VERIFY = ['Load the customize-theme skill', 'pnpm validate:config', 'pnpm verify'];

function groupsOf(items: readonly { group: ThemeTokenGroup }[]): ThemeTokenGroup[] {
  const present = new Set(items.map((item) => item.group));
  return THEME_TOKEN_GROUPS.filter((group) => present.has(group));
}

function blockFor(mode: ThemeTokenChange['mode'], group: ThemeTokenGroup): string {
  if (group === 'Type') return '@theme inline';
  return mode === 'dark' ? '.dark' : ':root';
}

/** The edit-session prompt: only the changed tokens, old → new, per theme. */
export function themeEditPrompt(changes: readonly ThemeTokenChange[]): AdminPrompt {
  const groups = groupsOf(changes);
  const lines = changes.map(
    (change) =>
      `- ${change.name} (${change.group}, ${blockFor(change.mode, change.group)}): ${change.from} → ${change.to}`,
  );
  const fontChanged = changes.some((change) => change.name === '--font-sans');
  return {
    where: `${THEME_SOURCE_PATH}, token groups: ${groups.join(', ')}`,
    what: `Change these theme tokens to the new values and leave every other token as it is.\n${lines.join('\n')}`,
    guardrails: fontChanged
      ? [
          ...GUARDRAILS,
          'Wire the chosen font permanently with next/font in the root layout; keep the Google Fonts @import from the copied CSS only as a fallback until that wiring is complete',
        ]
      : GUARDRAILS,
    verify: VERIFY,
  };
}
