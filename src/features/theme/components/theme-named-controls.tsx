'use client';

import * as React from 'react';
import { IconCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  BUTTON_RADIUS_CHOICES,
  BUTTON_RADIUS_TOKEN,
  CORNER_RADIUS_CHOICES,
  NAMED_THEME_COLORS,
  RADIUS_BASE_TOKEN,
  THEME_COLOR_GROUPS,
} from '../constants';
import { cascadeNamedColor, resolvedThemeValue } from '../lib/theme-cascade';
import { effectiveTokenValue, withTokenValue } from '../lib/theme-values';
import type { ThemeEditValues, ThemeMode, ThemeToken } from '../types';

import { NamedColorControl } from './named-color-control';
import { ThemeControlFallback, themeToken } from './theme-control-fallback';
import { ThemeFontControl } from './theme-font-control';

export type ThemeNamedControlsProps = {
  tokens: readonly ThemeToken[];
  values: ThemeEditValues;
  mode: ThemeMode;
  onValuesChange: (update: (current: ThemeEditValues) => ThemeEditValues) => void;
  onFontPreview: (preview: { name: string; value: string } | null) => void;
  loadFonts: boolean;
};

export function ThemeNamedControls(props: ThemeNamedControlsProps) {
  return (
    <div className="flex flex-col gap-7 py-1">
      {THEME_COLOR_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-title-card">{group.title}</h3>
            {group.hint ? <p className="text-meta text-muted-foreground">{group.hint}</p> : null}
          </div>
          <ThemePaletteControls {...props} tokenNames={group.tokens} />
        </div>
      ))}
      <div className="flex flex-col gap-3">
        <h3 className="text-title-card">Radius</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <ThemeCornerRadiusControl {...props} />
          <ThemeButtonRadiusControl {...props} />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-title-card">Type</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <ThemeFontControl {...props} />
        </div>
      </div>
    </div>
  );
}

export function ThemePaletteControls({
  tokens,
  values,
  mode,
  onValuesChange,
  className,
  tokenNames,
}: ThemeNamedControlsProps & { className?: string; tokenNames: readonly string[] }) {
  const controls = tokenNames.flatMap((name) =>
    NAMED_THEME_COLORS.filter((color) => color.token === name),
  );
  return (
    <div className={cn('grid grid-cols-2 gap-2', className)}>
      {controls.map((control) => {
        return (
          <ThemePaletteControl
            key={control.token}
            label={control.label}
            hint={control.hint}
            tokenName={control.token}
            companionNames={control.companions}
            tokens={tokens}
            values={values}
            mode={mode}
            onValuesChange={onValuesChange}
          />
        );
      })}
    </div>
  );
}

function ThemePaletteControl({
  label,
  hint,
  tokenName,
  companionNames,
  tokens,
  values,
  mode,
  onValuesChange,
}: {
  label: string;
  hint?: string;
  tokenName: string;
  companionNames: readonly string[];
} & Pick<ThemeNamedControlsProps, 'tokens' | 'values' | 'mode' | 'onValuesChange'>) {
  const token = themeToken(tokens, tokenName);
  if (!token) {
    return <ThemeControlFallback label={label} token={tokenName} mode={mode} reason="missing" />;
  }
  const color = resolvedThemeValue(tokens, values, mode, token.name);
  if (!color) {
    return <ThemeControlFallback label={label} token={tokenName} mode={mode} reason="unresolved" />;
  }
  return (
    <NamedColorControl
      label={label}
      hint={hint}
      color={color}
      onChange={(nextColor) =>
        onValuesChange((current) =>
          cascadeNamedColor({
            tokens,
            values: current,
            mode,
            tokenName,
            companionNames,
            color: nextColor,
          }),
        )
      }
    />
  );
}

type RadiusControlProps = ThemeNamedControlsProps & {
  label: string;
  tokenName: string;
  choices: readonly { label: string; value: string }[];
};

/** Same picker as Font: a field-shaped button that opens a list of choices. */
function ThemeRadiusControl({
  tokens,
  values,
  mode,
  onValuesChange,
  label,
  tokenName,
  choices,
}: RadiusControlProps) {
  const token = themeToken(tokens, tokenName);
  if (!token) {
    return <ThemeControlFallback label={label} token={tokenName} mode={mode} reason="missing" />;
  }
  const current = effectiveTokenValue(token, values, mode).trim();
  const selected = choices.find((choice) => choice.value === current)?.label ?? 'Custom';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" className="h-11 justify-between px-3 font-normal">
          <span className="text-muted-foreground">{label}</span>
          <span>{selected}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-52 flex-col gap-1 p-1.5">
        {choices.map((choice) => (
          <Button
            key={choice.value}
            type="button"
            variant="ghost"
            className="h-11 justify-between px-2.5 font-normal"
            aria-pressed={choice.label === selected}
            onClick={() =>
              onValuesChange((state) => withTokenValue(state, mode, token, choice.value))
            }
          >
            {choice.label}
            {choice.label === selected ? <IconCheck aria-hidden className="size-4" /> : null}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ThemeCornerRadiusControl(props: ThemeNamedControlsProps) {
  return (
    <ThemeRadiusControl
      {...props}
      label="Corner radius"
      tokenName={RADIUS_BASE_TOKEN}
      choices={CORNER_RADIUS_CHOICES}
    />
  );
}

export function ThemeButtonRadiusControl(props: ThemeNamedControlsProps) {
  return (
    <ThemeRadiusControl
      {...props}
      label="Button radius"
      tokenName={BUTTON_RADIUS_TOKEN}
      choices={BUTTON_RADIUS_CHOICES}
    />
  );
}
