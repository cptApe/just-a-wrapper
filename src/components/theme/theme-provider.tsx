'use client';

import { ThemeProvider as NextThemeProvider, useTheme as useNextTheme } from 'next-themes';

type Theme = 'light' | 'dark';
// What the user chose, which may be "follow the OS" — distinct from the
// resolved Theme actually painted.
export type ThemePreference = Theme | 'system';

// Wraps next-themes, which injects the blocking no-FOUC inline script and drives
// the `.dark` class on <html>. We keep this thin wrapper so feature code imports
// a stable local `useTheme`/`ThemeProvider` rather than the dependency directly.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}

type ThemeValue = {
  // The resolved, concrete theme ('light' | 'dark'), accounting for 'system'.
  theme: Theme;
  // The stored choice ('system' until the user picks an explicit theme).
  preference: ThemePreference;
  setTheme: (theme: Theme) => void;
  setPreference: (preference: ThemePreference) => void;
  toggleTheme: () => void;
};

export function useTheme(): ThemeValue {
  const { theme: stored, resolvedTheme, setTheme } = useNextTheme();
  const theme: Theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const preference: ThemePreference = stored === 'light' || stored === 'dark' ? stored : 'system';
  return {
    theme,
    preference,
    setTheme,
    setPreference: setTheme,
    toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
}
