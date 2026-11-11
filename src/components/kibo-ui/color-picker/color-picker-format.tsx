'use client';

import Color from 'color';
import { type ComponentProps, type HTMLAttributes, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useColorPicker } from '@/hooks/use-color-picker';
import { cn } from '@/lib/utils';

type PercentageInputProps = ComponentProps<typeof Input>;

const PercentageInput = ({ className, ...props }: PercentageInputProps) => {
  return (
    <div className="relative">
      <Input
        readOnly
        type="text"
        {...props}
        className={cn(
          'h-8 w-[3.25rem] rounded-l-none bg-secondary px-2 text-xs shadow-none',
          className,
        )}
      />
      <span className="-translate-y-1/2 absolute top-1/2 right-2 text-muted-foreground text-xs">
        %
      </span>
    </div>
  );
};

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>;

const HEX_PATTERN = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i;

/** The hex field is typed or pasted into as well as read: a valid 6 or 8 digit
    value commits to the picker state on every keystroke; anything else stays
    a draft until blur, when the field snaps back to the current colour. */
const HexInput = ({ hex }: { hex: string }) => {
  const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? hex;

  const commit = (value: string) => {
    const match = value.trim().match(HEX_PATTERN);
    if (!match) return;
    const next = Color(`#${match[1]}`);
    setHue(next.hue());
    setSaturation(next.saturationl());
    setLightness(next.lightness());
    setAlpha(next.alpha() * 100);
  };

  return (
    <Input
      className="h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none"
      type="text"
      spellCheck={false}
      autoComplete="off"
      aria-label="Hex color"
      value={shown}
      onFocus={() => {
        setDraft(hex);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        // eslint-disable-next-line just-a-wrapper/require-form-primitive -- Applies the typed colour to the picker; there is no form to submit.
        if (event.key === 'Enter') {
          commit(shown);
          event.currentTarget.blur();
        }
      }}
    />
  );
};

export const ColorPickerFormat = ({ className, ...props }: ColorPickerFormatProps) => {
  const { hue, saturation, lightness, alpha, mode } = useColorPicker();
  const color = Color.hsl(hue, saturation, lightness, alpha / 100);

  if (mode === 'hex') {
    const hex = color.hex();

    return (
      <div
        className={cn(
          '-space-x-px relative flex w-full items-center rounded-md shadow-sm',
          className,
        )}
        {...props}
      >
        <HexInput hex={hex} />
        <PercentageInput value={alpha} />
      </div>
    );
  }

  if (mode === 'rgb') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value));

    return (
      <div
        className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)}
        {...props}
      >
        {rgb.map((value, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index && 'rounded-l-none',
              className,
            )}
            key={['red', 'green', 'blue', 'alpha'][index]}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    );
  }

  if (mode === 'css') {
    const rgb = color
      .rgb()
      .array()
      .map((value) => Math.round(value));

    return (
      <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgba(${rgb.join(', ')}, ${alpha}%)`}
          {...props}
        />
      </div>
    );
  }

  if (mode === 'hsl') {
    const hsl = color
      .hsl()
      .array()
      .map((value) => Math.round(value));

    return (
      <div
        className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)}
        {...props}
      >
        {hsl.map((value, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index && 'rounded-l-none',
              className,
            )}
            key={['hue', 'saturation', 'lightness', 'alpha'][index]}
            readOnly
            type="text"
            value={value}
          />
        ))}
        <PercentageInput value={alpha} />
      </div>
    );
  }

  return null;
};
