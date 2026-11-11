'use client';

import dynamic from 'next/dynamic';
import * as React from 'react';
import { useThemeEditState } from '../hooks/use-theme-edit-state';
import { pruneThemeEditDraft } from '../lib/theme-edit-storage';
import type { ThemeToken } from '../types';

// Load editor controls only while editing so ordinary app navigation does not carry their bundle.
const ThemeEditCard = dynamic(
  () => import('./theme-edit-card').then((module) => module.ThemeEditCard),
  { ssr: false },
);

export function ThemeEditController({ tokens }: { tokens: ThemeToken[] }) {
  const state = useThemeEditState();
  const values = React.useMemo(
    () => ({ light: state.light, dark: state.dark }),
    [state.light, state.dark],
  );
  // A draft saved against an older globals.css may name tokens that no
  // longer exist; drop those so they neither paint nor ship.
  React.useEffect(() => {
    pruneThemeEditDraft(tokens.map((token) => token.name));
  }, [tokens]);
  if (!state.active) return null;
  return <ThemeEditCard tokens={tokens} values={values} />;
}
