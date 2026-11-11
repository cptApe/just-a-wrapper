'use client';

import * as Slider from '@radix-ui/react-slider';
import Color from 'color';
import {
  type ComponentProps,
  type HTMLAttributes,
  memo,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ColorPickerContext, useColorPicker } from '@/hooks/use-color-picker';
import { cn } from '@/lib/utils';
import {
  channelsFromSelection,
  colorReducer,
  dragReducer,
  selectionFromChannels,
} from './lib/color-machine';

export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  defaultValue?: Parameters<typeof Color>[0];
  onChange?: (value: readonly [number, number, number, number]) => void;
};

export const ColorPicker = ({
  defaultValue = '#000000',
  onChange,
  className,
  ...props
}: ColorPickerProps) => {
  const defaultColor = Color(defaultValue);

  const [state, dispatch] = useReducer(colorReducer, {
    kind: 'synced',
    channels: {
      hue: defaultColor.hue(),
      saturation: defaultColor.saturationl(),
      lightness: defaultColor.lightness(),
      alpha: defaultColor.alpha() * 100,
    },
  });
  const { hue, saturation, lightness, alpha } = state.channels;
  const [mode, setMode] = useState('hex');
  const setHue = (value: number) => dispatch({ type: 'channel', channel: 'hue', value });
  const setSaturation = (value: number) =>
    dispatch({ type: 'channel', channel: 'saturation', value });
  const setLightness = (value: number) =>
    dispatch({ type: 'channel', channel: 'lightness', value });
  const setAlpha = (value: number) => dispatch({ type: 'channel', channel: 'alpha', value });
  useEffect(() => {
    if (state.kind !== 'changed') return;
    const rgb = Color.hsl(hue, saturation, lightness)
      .alpha(alpha / 100)
      .rgb();
    onChange?.([rgb.red(), rgb.green(), rgb.blue(), alpha / 100]);
    dispatch({ type: 'emitted', channels: state.channels });
  }, [state, hue, saturation, lightness, alpha, onChange]);

  return (
    <ColorPickerContext.Provider
      value={{
        hue,
        saturation,
        lightness,
        alpha,
        mode,
        setHue,
        setSaturation,
        setLightness,
        setAlpha,
        setMode,
      }}
    >
      <div className={cn('flex size-full flex-col gap-4', className)} {...props} />
    </ColorPickerContext.Provider>
  );
};

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>;

export const ColorPickerSelection = memo(({ className, ...props }: ColorPickerSelectionProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, dispatchDrag] = useReducer(dragReducer, { kind: 'idle' });
  const { hue, saturation, lightness, setSaturation, setLightness } = useColorPicker();
  const { x: positionX, y: positionY } =
    drag.kind === 'dragging' ? drag : selectionFromChannels(saturation, lightness);

  const backgroundGradient = useMemo(() => {
    return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`;
  }, [hue]);

  const updatePosition = (
    event: { clientX: number; clientY: number; pointerId: number },
    type: 'start' | 'move',
  ) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    dispatchDrag({ type, pointerId: event.pointerId, x, y });
    const channels = channelsFromSelection(x, y);
    setSaturation(channels.saturation);
    setLightness(channels.lightness);
  };

  return (
    <div
      className={cn('relative size-full cursor-crosshair rounded-sm', className)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        updatePosition(e, 'start');
      }}
      onPointerMove={(event) => {
        if (drag.kind === 'dragging' && drag.pointerId === event.pointerId)
          updatePosition(event, 'move');
      }}
      onPointerUp={(event) => dispatchDrag({ type: 'end', pointerId: event.pointerId })}
      onPointerCancel={(event) => dispatchDrag({ type: 'end', pointerId: event.pointerId })}
      onLostPointerCapture={(event) => dispatchDrag({ type: 'end', pointerId: event.pointerId })}
      ref={containerRef}
      style={{
        background: backgroundGradient,
      }}
      {...props}
    >
      <div
        // eslint-disable-next-line just-a-wrapper/no-raw-color-literals -- the picker renders the physical color spectrum; these literals are not themeable UI color
        className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
        style={{
          left: `${positionX * 100}%`,
          top: `${positionY * 100}%`,
          // eslint-disable-next-line just-a-wrapper/no-raw-color-literals -- the picker renders the physical color spectrum; these literals are not themeable UI color
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
});

ColorPickerSelection.displayName = 'ColorPickerSelection';

export type ColorPickerHueProps = ComponentProps<typeof Slider.Root>;

export const ColorPickerHue = ({ className, ...props }: ColorPickerHueProps) => {
  const { hue, setHue } = useColorPicker();

  return (
    <Slider.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={360}
      onValueChange={(values) => {
        const hue = values.at(0);
        if (hue !== undefined) setHue(hue);
      }}
      step={1}
      value={[hue]}
      {...props}
    >
      {/* eslint-disable-next-line just-a-wrapper/no-raw-color-literals -- the picker renders the physical color spectrum; these literals are not themeable UI color */}
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <Slider.Range className="absolute h-full" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  );
};

export type ColorPickerAlphaProps = ComponentProps<typeof Slider.Root>;

export const ColorPickerAlpha = ({ className, ...props }: ColorPickerAlphaProps) => {
  const { alpha, setAlpha } = useColorPicker();

  return (
    <Slider.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      max={100}
      onValueChange={(values) => {
        const alpha = values.at(0);
        if (alpha !== undefined) setAlpha(alpha);
      }}
      step={1}
      value={[alpha]}
      {...props}
    >
      <Slider.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIA/nYDCgBDAm9BGDWAAJyRCgLaBCAAgXwixzAS0pgAAAABJRU5ErkJggg==')] bg-center bg-repeat-x dark:bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALklEQVR4nGP8+vWrCAMewM3N/QafPBM+SWLAqAGDwQBGQgoIpZOB98KoAVQwAADxzQcSVIRCfQAAAABJRU5ErkJggg==')]">
        {/* eslint-disable-next-line just-a-wrapper/no-raw-color-literals -- the picker renders the physical color spectrum; these literals are not themeable UI color */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-transparent to-black/50 dark:to-white/50" />
        <Slider.Range className="absolute h-full rounded-full bg-transparent" />
      </Slider.Track>
      <Slider.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </Slider.Root>
  );
};

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>;

const formats = ['hex', 'rgb', 'css', 'hsl'];

export const ColorPickerOutput = ({ className, ...props }: ColorPickerOutputProps) => {
  const { mode, setMode } = useColorPicker();

  return (
    <Select onValueChange={setMode} value={mode}>
      <SelectTrigger className={cn('h-8 w-20 shrink-0 text-xs', className)} {...props}>
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {formats.map((format) => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export { ColorPickerEyeDropper } from './color-picker-eye-dropper';
export { ColorPickerFormat } from './color-picker-format';
