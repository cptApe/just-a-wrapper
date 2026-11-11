'use client';

import * as React from 'react';
import {
  baselineTokenValue,
  effectiveTokenValue,
  hasThemeEdits,
  themeTokenChanges,
} from '../lib/theme-values';
import type { ThemeEditValues, ThemeMode, ThemeToken } from '../types';

// Diff root writes so a keystroke touches only changed tokens; unmount removes every inline edit.
// Draft ownership stays with the caller so leaving preview never discards it.
export function useThemeEdits({
  tokens,
  mode,
  values,
}: {
  tokens: readonly ThemeToken[];
  mode: ThemeMode;
  values: ThemeEditValues;
}) {
  // What is currently written on the root, by token name.
  const appliedRef = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    const root = document.documentElement.style;
    const applied = appliedRef.current;
    for (const token of tokens) {
      const value = effectiveTokenValue(token, values, mode);
      if (value === baselineTokenValue(token, mode)) {
        if (applied.has(token.name)) {
          root.removeProperty(token.name);
          applied.delete(token.name);
        }
        continue;
      }
      if (applied.get(token.name) === value) continue;
      root.setProperty(token.name, value);
      applied.set(token.name, value);
    }
  }, [tokens, mode, values]);

  React.useEffect(
    () => () => {
      const applied = appliedRef.current;
      for (const name of applied.keys()) document.documentElement.style.removeProperty(name);
      applied.clear();
    },
    [],
  );

  return {
    valueFor: (token: ThemeToken) => effectiveTokenValue(token, values, mode),
    isEdited: (token: ThemeToken) =>
      effectiveTokenValue(token, values, mode) !== baselineTokenValue(token, mode),
    hasEdits: hasThemeEdits(values),
    changes: themeTokenChanges(tokens, values),
  };
}
