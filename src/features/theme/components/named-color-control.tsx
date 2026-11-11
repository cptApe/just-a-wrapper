'use client';

import Color from 'color';
import * as React from 'react';
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from '@/components/kibo-ui/color-picker';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { captureException } from '@/lib/observability-client';

function normalizeCssColor(value: string): string | null {
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color || null;
}

export function NamedColorControl({
  label,
  hint,
  color,
  onChange,
}: {
  label: string;
  hint?: string;
  color: string;
  onChange: (color: string) => void;
}) {
  const normalized = normalizeCssColor(color);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const handlePickerChange = React.useCallback(
    (rgba: readonly [number, number, number, number]) => {
      const [r, g, b, a] = rgba;
      try {
        const current = Color(color).rgb();
        if (
          Math.abs(current.red() - r) < 0.5 &&
          Math.abs(current.green() - g) < 0.5 &&
          Math.abs(current.blue() - b) < 0.5 &&
          Math.abs(current.alpha() - a) < 0.005
        ) {
          return;
        }
      } catch (error) {
        // Unsupported CSS color syntax must still allow a replacement from the picker.
        captureException(error, { op: 'theme.color-picker-echo-check', color });
      }
      onChangeRef.current(
        a >= 1
          ? `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`
          : `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)} / ${a})`,
      );
    },
    [color],
  );
  return (
    <Popover>
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11 min-w-0 justify-start gap-2 px-2.5 font-normal"
                aria-label={`Change ${label.toLowerCase()}`}
              >
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-full border border-border"
                  style={{ background: color }}
                />
                <span className="truncate text-meta">{label}</span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          {hint ? <TooltipContent side="bottom">{hint}</TooltipContent> : null}
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="start" className="w-72">
        <ColorPicker
          className="flex flex-col gap-3"
          defaultValue={normalized ?? '#000000'}
          onChange={handlePickerChange}
        >
          <ColorPickerSelection className="h-36 w-full rounded-lg" />
          <div className="flex items-center gap-3">
            <ColorPickerEyeDropper />
            <div className="flex w-full flex-col gap-2">
              <ColorPickerHue />
              <ColorPickerAlpha />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ColorPickerOutput />
            <ColorPickerFormat />
          </div>
        </ColorPicker>
      </PopoverContent>
    </Popover>
  );
}
