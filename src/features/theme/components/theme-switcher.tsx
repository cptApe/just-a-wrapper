'use client';

import { useTheme } from '@/components/theme/theme-provider';
import { LIGHT_DARK_OPTIONS, ThemeIconSwitch } from '@/components/theme/theme-switch';

/** The edit panel's light/dark toggle: the shared switch, driving the real theme. */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <ThemeIconSwitch
      options={LIGHT_DARK_OPTIONS}
      value={theme === 'dark' ? 'dark' : 'light'}
      onChange={setTheme}
    />
  );
}
