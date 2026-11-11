'use client';

import * as React from 'react';
import { IconCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  googleFontImportForValue,
  installThemePreviewFonts,
  THEME_FONT_CHOICES,
} from '../lib/theme-fonts';
import { effectiveTokenValue, withTokenValue } from '../lib/theme-values';
import type { ThemeToken } from '../types';
import { ThemeControlFallback, themeToken } from './theme-control-fallback';
import type { ThemeNamedControlsProps } from './theme-named-controls';

// The font picker previews each choice in its own face, so it loads the preview fonts while open.
export function ThemeFontControl({ tokens, mode, ...props }: ThemeNamedControlsProps) {
  const font = themeToken(tokens, '--font-sans');
  if (!font) {
    return <ThemeControlFallback label="Font" token="--font-sans" mode={mode} reason="missing" />;
  }
  return <ThemeFontControlReady {...props} tokens={tokens} mode={mode} font={font} />;
}

function ThemeFontControlReady({
  font,
  values,
  mode,
  onValuesChange,
  onFontPreview,
  loadFonts,
}: ThemeNamedControlsProps & { font: ThemeToken }) {
  const effective = effectiveTokenValue(font, values, mode);
  const selected =
    THEME_FONT_CHOICES.find((choice) => (choice.value ?? font.value) === effective) ??
    ({ label: 'Custom', value: effective } satisfies { label: string; value: string });

  const [open, setOpen] = React.useState(false);
  const needsPreviewFonts = loadFonts || open || googleFontImportForValue(effective) !== null;
  React.useEffect(() => {
    if (!needsPreviewFonts) return;
    return installThemePreviewFonts(document);
  }, [needsPreviewFonts]);

  const preview = (value: string | null) =>
    onFontPreview(value === null ? null : { name: font.name, value });

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) preview(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          className="h-11 justify-between px-3 font-normal"
          style={{ fontFamily: effective }}
        >
          <span className="text-muted-foreground">Font</span>
          <span>{selected.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-60 flex-col gap-0.5 p-1.5">
        {THEME_FONT_CHOICES.map((choice) => {
          const value = choice.value ?? font.value;
          const isSelected = value === effective;
          return (
            <Button
              key={choice.label}
              type="button"
              variant="ghost"
              className="h-11 justify-between px-2.5 font-normal"
              style={{ fontFamily: value }}
              aria-pressed={isSelected}
              onClick={() => {
                preview(null);
                onValuesChange((current) => withTokenValue(current, mode, font, value));
              }}
              onMouseEnter={() => preview(value)}
              onMouseLeave={() => preview(null)}
              onFocus={() => preview(value)}
              onBlur={() => preview(null)}
            >
              <span>{choice.label}</span>
              {isSelected ? <IconCheck aria-hidden className="size-4" /> : null}
            </Button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
