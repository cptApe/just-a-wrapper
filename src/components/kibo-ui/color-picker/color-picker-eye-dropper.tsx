'use client';

import Color from 'color';
import { type ComponentProps } from 'react';
import { IconColors } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useColorPicker } from '@/hooks/use-color-picker';
import { captureException } from '@/lib/observability-client';
import { cn } from '@/lib/utils';

declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  }
}
export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>;

export const ColorPickerEyeDropper = ({ className, ...props }: ColorPickerEyeDropperProps) => {
  const { setHue, setSaturation, setLightness, setAlpha } = useColorPicker();

  const handleEyeDropper = async () => {
    try {
      if (!window.EyeDropper) return;
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      const color = Color(result.sRGBHex);
      setHue(color.hue());
      setSaturation(color.saturationl());
      setLightness(color.lightness());
      setAlpha(100);
    } catch (error) {
      // Unavailable API or a dismissed dropper: keep the current color.
      captureException(error, { op: 'theme.eyedropper' });
    }
  };

  return (
    <Button
      className={cn('shrink-0 text-muted-foreground', className)}
      onClick={handleEyeDropper}
      size="icon"
      type="button"
      variant="secondary"
      {...props}
    >
      <IconColors className="size-4" />
    </Button>
  );
};
