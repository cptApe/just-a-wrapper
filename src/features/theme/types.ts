export type ThemeTokenGroup = 'Colors' | 'Radius' | 'Type';

export type ThemeToken = {
  name: string;
  value: string;
  darkValue?: string;
  group: ThemeTokenGroup;
};

export type ThemeMode = 'light' | 'dark';

/** User overrides only, keyed by token name. The baseline is always re-derived
    from the parsed tokens, never copied into this shape. */
export type ThemeEditValues = {
  light: Partial<Record<string, string>>;
  dark: Partial<Record<string, string>>;
};

/** Sparse overrides synchronized between edit surfaces. */
export type ThemeEditState = ThemeEditValues & {
  active: boolean;
};

export type ThemeTokenChange = {
  name: string;
  group: ThemeTokenGroup;
  mode: ThemeMode;
  from: string;
  to: string;
};
