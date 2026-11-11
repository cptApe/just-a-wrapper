'use client';

import { NAMED_THEME_COLORS } from '../constants';
import { useThemeEditState } from '../hooks/use-theme-edit-state';
import { updateThemeEditValues } from '../lib/theme-edit-storage';
import { setThemeHoverPreview } from '../lib/theme-hover-preview';
import { effectiveTokenValue } from '../lib/theme-values';
import type { ThemeEditValues, ThemeMode, ThemeToken } from '../types';
import { ThemeFontControl } from './theme-font-control';
import {
  ThemeButtonRadiusControl,
  ThemeCornerRadiusControl,
  type ThemeNamedControlsProps,
  ThemePaletteControls,
} from './theme-named-controls';

export function ThemeCurrentLook({ tokens }: { tokens: readonly ThemeToken[] }) {
  const state = useThemeEditState();
  const values = { light: state.light, dark: state.dark };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['light', 'dark'] as const).map((mode) => (
        <LookCard key={mode} mode={mode} tokens={tokens} values={values} />
      ))}
    </div>
  );
}

function LookCard({
  mode,
  tokens,
  values,
}: {
  mode: ThemeMode;
  tokens: readonly ThemeToken[];
  values: ThemeEditValues;
}) {
  const controls = {
    tokens,
    values,
    mode,
    onValuesChange: updateThemeEditValues,
    onFontPreview: setThemeHoverPreview,
    loadFonts: false,
  } satisfies ThemeNamedControlsProps;
  const modeProperties = Object.fromEntries(
    tokens.map((token) => [token.name, effectiveTokenValue(token, values, mode)]),
  );
  return (
    <article
      className="flex min-w-0 flex-col gap-5 border p-5 sm:p-6"
      style={{
        ...modeProperties,
        background: 'var(--background)',
        borderColor: 'var(--border)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--foreground)',
      }}
    >
      <h3 className="text-title-card">{mode === 'light' ? 'Light' : 'Dark'}</h3>
      <ThemePaletteControls
        {...controls}
        tokenNames={NAMED_THEME_COLORS.map((color) => color.token)}
      />
      <div className="mt-auto grid gap-2 lg:grid-cols-2">
        <ThemeCornerRadiusControl {...controls} />
        <ThemeButtonRadiusControl {...controls} />
        <ThemeFontControl {...controls} />
      </div>
    </article>
  );
}
