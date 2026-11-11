import type { ThemeEditValues, ThemeMode, ThemeToken, ThemeTokenChange } from '../types';

// Pure value algebra shared by the /admin/theme page, the admin edit card,
// and the /admin/theme reference page. Overrides are sparse: a token is
// "edited" only while its stored value differs from the parsed baseline.

export const EMPTY_THEME_EDIT_VALUES: ThemeEditValues = { light: {}, dark: {} };

// Bare HSL channels (`0 0% 100%`, `0 0% 0% / 3%`) — the neutral/accent/alpha
// spine is declared this way so consumers can wrap it in hsl() themselves.
const HSL_CHANNELS =
  /^-?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)?\s+\d+\.?\d*%\s+\d+\.?\d*%(?:\s*\/\s*\d+\.?\d*%?)?$/;
const VAR_REFERENCE = /var\((--[\w-]+)\)/g;
// Deep enough for the real chains (surface → neutral, radius → radius-lg) and
// a hard stop for a cyclic var() reference in a hand-edited globals.css.
const MAX_RESOLVE_DEPTH = 8;

export function baselineTokenValue(token: ThemeToken, mode: ThemeMode): string {
  return mode === 'dark' ? (token.darkValue ?? token.value) : token.value;
}

/** The value the root currently carries for `token` in `mode`: the override,
    else the baseline. A token with no dark declaration follows the light
    value (and the light override) in dark mode, exactly as the cascade does. */
export function effectiveTokenValue(
  token: ThemeToken,
  values: ThemeEditValues,
  mode: ThemeMode,
): string {
  // Dark declarations shadow light overrides; undeclared dark tokens inherit light.
  return values[mode][token.name] ?? inheritedBaseline(token, values, mode);
}

// Compare dark edits against inherited light overrides when no dark declaration exists; bare light baselines lose real edits.
export function withTokenValue(
  values: ThemeEditValues,
  mode: ThemeMode,
  token: ThemeToken,
  value: string,
): ThemeEditValues {
  const rest = Object.fromEntries(
    Object.entries(values[mode]).filter(([name]) => name !== token.name),
  );
  const baseline = inheritedBaseline(token, values, mode);
  const next = value === baseline ? rest : { ...rest, [token.name]: value };
  return mode === 'dark' ? { ...values, dark: next } : { ...values, light: next };
}

export function hasThemeEdits(values: ThemeEditValues): boolean {
  return Object.keys(values.light).length > 0 || Object.keys(values.dark).length > 0;
}

/** Sparse inline overrides for one preview mode, using the same dark fallback
    rules as every visible control. */
export function effectiveThemeOverrides(
  tokens: readonly ThemeToken[],
  values: ThemeEditValues,
  mode: ThemeMode,
): Record<string, string> {
  return Object.fromEntries(
    tokens.flatMap((token) => {
      const value = effectiveTokenValue(token, values, mode);
      return value === baselineTokenValue(token, mode) ? [] : [[token.name, value]];
    }),
  );
}

/** Every override that differs from its baseline, light then dark, in source
    order — the input to the agent prompt. */
export function themeTokenChanges(
  tokens: readonly ThemeToken[],
  values: ThemeEditValues,
): ThemeTokenChange[] {
  const modes: ThemeMode[] = ['light', 'dark'];
  return modes.flatMap((mode) =>
    tokens.flatMap((token) => {
      const to = values[mode][token.name];
      const from = baselineTokenValue(token, mode);
      if (to === undefined || to === from) return [];
      return [{ name: token.name, group: token.group, mode, from, to }];
    }),
  );
}

function isHslChannels(value: string): boolean {
  return HSL_CHANNELS.test(value.trim());
}

/** Substitute nested var() references through `lookup` (unknown names, e.g.
    the Inter font variable, are left for the browser) and wrap bare channels
    in hsl(), so the result is a paintable, context-free CSS value. */
export function resolveCssValue(
  value: string,
  lookup: (name: string) => string | undefined,
): string {
  const substitute = (input: string, depth: number): string =>
    input.replace(VAR_REFERENCE, (reference, name: string) => {
      const referenced = lookup(name);
      if (referenced === undefined || depth >= MAX_RESOLVE_DEPTH) return reference;
      return substitute(referenced, depth + 1);
    });
  const resolved = substitute(value, 0).trim();
  return isHslChannels(resolved) ? `hsl(${resolved})` : resolved;
}

export type ThemeResolver = {
  /** Resolve any CSS value against the baseline of one theme. */
  resolve: (value: string, mode: ThemeMode) => string;
  /** The resolved baseline of the named token, or undefined if unknown. */
  resolveToken: (name: string, mode: ThemeMode) => string | undefined;
};

/** One index over the token list (built once) behind both resolvers, so the
    reference page resolves every cell without rescanning the list. */
export function createThemeResolver(tokens: readonly ThemeToken[]): ThemeResolver {
  const byName = new Map(tokens.map((token) => [token.name, token]));
  const lookupFor = (mode: ThemeMode) => (name: string) => {
    const token = byName.get(name);
    return token ? baselineTokenValue(token, mode) : undefined;
  };
  const lookups: Record<ThemeMode, (name: string) => string | undefined> = {
    light: lookupFor('light'),
    dark: lookupFor('dark'),
  };
  return {
    resolve: (value, mode) => resolveCssValue(value, lookups[mode]),
    resolveToken: (name, mode) => {
      const token = byName.get(name);
      return token ? resolveCssValue(baselineTokenValue(token, mode), lookups[mode]) : undefined;
    },
  };
}

function inheritedBaseline(token: ThemeToken, values: ThemeEditValues, mode: ThemeMode): string {
  if (mode === 'light') return token.value;
  if (token.darkValue !== undefined) return token.darkValue;
  return values.light[token.name] ?? token.value;
}
