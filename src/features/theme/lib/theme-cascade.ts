import type { ThemeEditValues, ThemeMode, ThemeToken } from '../types';
import { effectiveTokenValue, resolveCssValue, withTokenValue } from './theme-values';

type Hsla = { h: number; s: number; l: number; a: number };

const MIN_TEXT_CONTRAST = 4.5;
// Short, bold button labels use the large-text 3:1 bar, preserving white ink on saturated fills where readable.
const MIN_FILL_LABEL_CONTRAST = 3;
const FILL_FOREGROUNDS = new Set(['--primary-foreground', '--destructive-foreground']);
const CHANNELS_WITHOUT_ALPHA = new Set(['--success-hsl', '--destructive-hsl']);
const ALPHA_COMPANIONS = new Set([
  '--border',
  '--input',
  '--ring',
  '--muted',
  '--secondary',
  '--sidebar-accent',
  '--sidebar-border',
  '--glass-bg-hover',
  '--glass-separator',
]);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function parseAlpha(value: string | undefined): number {
  if (!value) return 1;
  const number = Number.parseFloat(value);
  return value.endsWith('%') ? number / 100 : number;
}

function parseHsl(value: string): Hsla | null {
  const match = value
    .trim()
    .match(/^hsl\(\s*(-?[\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (!match) return null;
  const [, first, second, third, alpha] = match;
  return {
    h: Number(first),
    s: Number(second),
    l: Number(third),
    a: parseAlpha(alpha),
  };
}

function rgbToHsl(red: number, green: number, blue: number, alpha: number): Hsla {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { h: (hue + 360) % 360, s: saturation * 100, l: lightness * 100, a: alpha };
}

function parseRgb(value: string): Hsla | null {
  const match = value
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*\/\s*|\s*,\s*)?([\d.]+%?)?\s*\)$/i);
  if (!match) return null;
  const [, first, second, third, alpha] = match;
  return rgbToHsl(Number(first), Number(second), Number(third), parseAlpha(alpha));
}

function parseHex(value: string): Hsla | null {
  const hex = value.trim().match(/^#([\da-f]{6})([\da-f]{2})?$/i);
  const channels = hex?.at(1);
  if (!channels) return null;
  const alpha = hex?.at(2);
  return rgbToHsl(
    Number.parseInt(channels.slice(0, 2), 16),
    Number.parseInt(channels.slice(2, 4), 16),
    Number.parseInt(channels.slice(4, 6), 16),
    alpha === undefined ? 1 : Number.parseInt(alpha, 16) / 255,
  );
}

function parseColor(value: string): Hsla | null {
  const normalized = value.trim();
  if (normalized.startsWith('#')) return parseHex(normalized);
  if (/^hsl/i.test(normalized)) return parseHsl(normalized);
  return parseRgb(normalized);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatHsl(
  color: Hsla,
  { channelsOnly, stripAlpha }: { channelsOnly: boolean; stripAlpha: boolean },
): string {
  const hue = color.s < 0.01 ? 0 : (color.h + 360) % 360;
  const channels = `${formatNumber(hue)} ${formatNumber(color.s)}% ${formatNumber(color.l)}%`;
  const alpha = stripAlpha ? 1 : color.a;
  if (channelsOnly) {
    return alpha < 0.999 ? `${channels} / ${formatNumber(alpha)}` : channels;
  }
  return alpha < 0.999 ? `hsl(${channels} / ${formatNumber(alpha)})` : `hsl(${channels})`;
}

function hslToRgb({ h, s, l }: Hsla): [number, number, number] {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = ((h % 360) + 360) % 360;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue]: [number, number, number] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match];
}

function relativeLuminance(color: Hsla): number {
  const [red, green, blue] = hslToRgb(color);
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return linear(red) * 0.2126 + linear(green) * 0.7152 + linear(blue) * 0.0722;
}

function contrastRatio(first: Hsla, second: Hsla): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function foregroundCompanion(name: string, base: Hsla, companion: Hsla, next: Hsla): Hsla {
  const light = { h: 0, s: 0, l: 100, a: 1 };
  const dark = { h: 0, s: 0, l: 0, a: 1 };
  if (FILL_FOREGROUNDS.has(name)) {
    return contrastRatio(next, light) >= MIN_FILL_LABEL_CONTRAST ? light : dark;
  }
  const preferred = companion.l >= base.l ? light : dark;
  if (contrastRatio(next, preferred) >= MIN_TEXT_CONTRAST) return preferred;
  return preferred === light ? dark : light;
}

function alphaCompanion(companion: Hsla, next: Hsla): Hsla {
  return { h: 0, s: 0, l: relativeLuminance(next) > 0.179 ? 0 : 100, a: companion.a };
}

/** Menu ink: pick white or black for the new menu colour, then keep the
    companion's step (primary / secondary / tertiary) as a lightness offset
    from that ink so the three text levels stay distinct. */
function glassInkCompanion(companion: Hsla, next: Hsla): Hsla {
  const light = { h: 0, s: 0, l: 100, a: 1 };
  const useLight = contrastRatio(next, light) >= MIN_FILL_LABEL_CONTRAST;
  const step = 100 - companion.l;
  return { h: 0, s: 0, l: useLight ? 100 - step : step, a: 1 };
}

function shiftCompanion(name: string, base: Hsla, companion: Hsla, next: Hsla): Hsla {
  if (name.startsWith('--glass-fg')) return glassInkCompanion(companion, next);
  if (name.endsWith('-foreground')) return foregroundCompanion(name, base, companion, next);
  if (name.startsWith('--alpha-') || ALPHA_COMPANIONS.has(name)) {
    return alphaCompanion(companion, next);
  }
  const hueDelta = companion.s < 0.01 ? 0 : companion.h - base.h;
  const saturationRatio = base.s < 0.01 ? 1 : companion.s / base.s;
  return {
    h: next.h + hueDelta,
    s: clamp(next.s * saturationRatio, 0, 100),
    l: clamp(next.l + companion.l - base.l, 0, 100),
    a: clamp(next.a * (base.a === 0 ? companion.a : companion.a / base.a), 0, 1),
  };
}

function isChannelsValue(value: string): boolean {
  return /^-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%/.test(value);
}

function formattedTokenColor(name: string, rawValue: string, color: Hsla): string {
  return formatHsl(color, {
    channelsOnly: isChannelsValue(rawValue),
    stripAlpha: CHANNELS_WITHOUT_ALPHA.has(name),
  });
}

/** Recolor a named role and its current companions. Relationships are measured
    from the parsed theme for the selected mode; no palette values live here. */
export function cascadeNamedColor({
  tokens,
  values,
  mode,
  tokenName,
  companionNames,
  color,
}: {
  tokens: readonly ThemeToken[];
  values: ThemeEditValues;
  mode: ThemeMode;
  tokenName: string;
  companionNames: readonly string[];
  color: string;
}): ThemeEditValues {
  const byName = new Map(tokens.map((token) => [token.name, token]));
  const baseToken = byName.get(tokenName);
  const nextBase = parseColor(color);
  if (!baseToken || !nextBase) return values;

  const rawBaseline = (name: string) => {
    const token = byName.get(name);
    if (!token) return undefined;
    return mode === 'dark' ? (token.darkValue ?? token.value) : token.value;
  };
  const rawBaseValue = rawBaseline(tokenName) ?? '';
  const formattedBase = formattedTokenColor(tokenName, rawBaseValue, nextBase);
  const baselineBaseValue = resolveCssValue(rawBaseValue, rawBaseline);
  const baselineBase = parseColor(baselineBaseValue);
  if (!baselineBase) return withTokenValue(values, mode, baseToken, formattedBase);

  let nextValues = withTokenValue(values, mode, baseToken, formattedBase);
  for (const name of companionNames) {
    const token = byName.get(name);
    if (!token) continue;
    const baseline = parseColor(resolveCssValue(rawBaseline(name) ?? '', rawBaseline));
    if (!baseline) continue;
    let relationshipBase = baselineBase;
    let relationshipNext = nextBase;
    if (name.endsWith('-foreground')) {
      const surfaceName = name.slice(0, -'-foreground'.length);
      const baselineSurface = parseColor(
        resolveCssValue(rawBaseline(surfaceName) ?? '', rawBaseline),
      );
      const nextSurfaceValue = resolvedThemeValue(tokens, nextValues, mode, surfaceName);
      const nextSurface = nextSurfaceValue ? parseColor(nextSurfaceValue) : null;
      // Translucent surfaces inherit their already-checked parent; keep the chosen ink without a second contrast flip.
      if (
        tokenName === '--foreground' &&
        nextSurface &&
        (nextSurface.a < 0.999 || contrastRatio(nextBase, nextSurface) >= MIN_TEXT_CONTRAST)
      ) {
        nextValues = withTokenValue(
          nextValues,
          mode,
          token,
          formattedTokenColor(name, rawBaseline(name) ?? '', nextBase),
        );
        continue;
      }
      if (baselineSurface && nextSurface) {
        relationshipBase = baselineSurface;
        relationshipNext = nextSurface;
      }
    }
    nextValues = withTokenValue(
      nextValues,
      mode,
      token,
      formattedTokenColor(
        name,
        rawBaseline(name) ?? '',
        shiftCompanion(name, relationshipBase, baseline, relationshipNext),
      ),
    );
  }
  return nextValues;
}

export function resolvedThemeValue(
  tokens: readonly ThemeToken[],
  values: ThemeEditValues,
  mode: ThemeMode,
  name: string,
): string | undefined {
  const byName = new Map(tokens.map((token) => [token.name, token]));
  const lookup = (tokenName: string) => {
    const token = byName.get(tokenName);
    return token ? effectiveTokenValue(token, values, mode) : undefined;
  };
  const value = lookup(name);
  if (value === undefined) return undefined;
  const resolved = resolveCssValue(value, lookup);
  return /var\(/i.test(resolved) ? undefined : resolved;
}
