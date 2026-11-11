'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AdminSection } from '@/components/admin/admin-section';
import { useTheme } from '@/components/theme/theme-provider';
import { LIGHT_DARK_OPTIONS, ThemeIconSwitch } from '@/components/theme/theme-switch';
import { useHydrated } from '@/hooks/use-hydrated';
import { useThemeEditState } from '../hooks/use-theme-edit-state';
import { googleFontImportForValue, installThemePreviewFonts } from '../lib/theme-fonts';
import {
  getThemeHoverPreview,
  subscribeThemeHoverPreview,
  type ThemeHoverPreview,
} from '../lib/theme-hover-preview';
import { effectiveThemeOverrides, effectiveTokenValue } from '../lib/theme-values';
import type { ThemeToken } from '../types';

// Preview the real same-origin app; its scheme is independent of the surrounding admin page.
type PreviewMode = 'light' | 'dark';

function applyMode(frame: HTMLIFrameElement | null, mode: PreviewMode) {
  const doc = frame?.contentDocument;
  if (!doc) return;
  doc.documentElement.classList.toggle('dark', mode === 'dark');
  doc.documentElement.style.colorScheme = mode;
}

/** The Preview admin section: the scheme toggle rides the header row, so it
 *  owns the mode state and hands it to the iframe preview below. */
export function ThemePreviewSection({ tokens }: { tokens: readonly ThemeToken[] }) {
  const { theme } = useTheme();
  const hydrated = useHydrated();
  const [selectedMode, setSelectedMode] = useState<PreviewMode | null>(null);
  // next-themes can read the stored theme in the browser, but SSR cannot. Keep
  // hydration on the deterministic light snapshot, then adopt the real theme
  // unless the admin has explicitly picked a preview mode.
  const mode = selectedMode ?? (hydrated ? theme : 'light');
  return (
    <AdminSection
      title="Preview"
      support="Any changes you make show up live below."
      action={
        <ThemeIconSwitch
          options={LIGHT_DARK_OPTIONS}
          value={mode}
          onChange={setSelectedMode}
          label="Preview theme"
        />
      }
    >
      <ThemeLivePreview tokens={tokens} mode={mode} />
    </AdminSection>
  );
}

function ThemeLivePreview({ tokens, mode }: { tokens: readonly ThemeToken[]; mode: PreviewMode }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const edits = useThemeEditState();
  const appliedRef = useRef<Set<string>>(new Set());
  const fontCleanupRef = useRef<(() => void) | null>(null);

  // Mirror the shared edit draft into the embedded document, so playing with
  // a swatch above restyles the real app below immediately.
  const applyEdits = useCallback(
    (nextMode: PreviewMode) => {
      const root = frameRef.current?.contentDocument?.documentElement;
      if (!root) return;
      const values = effectiveThemeOverrides(tokens, edits, nextMode);
      for (const name of appliedRef.current) {
        if (!(name in values)) root.style.removeProperty(name);
      }
      const applied = new Set<string>();
      for (const [name, value] of Object.entries(values)) {
        root.style.setProperty(name, value);
        applied.add(name);
      }
      appliedRef.current = applied;
    },
    [edits, tokens],
  );

  useEffect(() => {
    applyEdits(mode);
  }, [applyEdits, mode]);

  // Paint the transient hover preview on top of the draft; dropping the hover
  // re-applies the draft, which clears anything the hover touched.
  const hover = useSyncExternalStore<ThemeHoverPreview>(
    subscribeThemeHoverPreview,
    getThemeHoverPreview,
    () => null,
  );
  const lastHoverNameRef = useRef<string | null>(null);
  const fontToken = tokens.find((token) => token.name === '--font-sans');
  const fontValue =
    hover?.name === '--font-sans'
      ? hover.value
      : fontToken
        ? effectiveTokenValue(fontToken, edits, mode)
        : undefined;
  const needsPreviewFonts = googleFontImportForValue(fontValue) !== null;
  const syncPreviewFonts = useCallback(() => {
    fontCleanupRef.current?.();
    fontCleanupRef.current = null;
    const frameDocument = frameRef.current?.contentDocument;
    if (needsPreviewFonts && frameDocument) {
      fontCleanupRef.current = installThemePreviewFonts(frameDocument);
    }
  }, [needsPreviewFonts]);

  useEffect(() => {
    syncPreviewFonts();
    return () => {
      fontCleanupRef.current?.();
      fontCleanupRef.current = null;
    };
  }, [syncPreviewFonts]);

  useEffect(() => {
    const root = frameRef.current?.contentDocument?.documentElement;
    if (!root) return;
    if (hover) {
      root.style.setProperty(hover.name, hover.value);
      lastHoverNameRef.current = hover.name;
      return;
    }
    if (lastHoverNameRef.current) {
      root.style.removeProperty(lastHoverNameRef.current);
      lastHoverNameRef.current = null;
      applyEdits(mode);
    }
  }, [hover, applyEdits, mode]);

  const handleLoad = useCallback(() => {
    syncPreviewFonts();
    applyMode(frameRef.current, mode);
    applyEdits(mode);
  }, [mode, applyEdits, syncPreviewFonts]);

  // Mode changes arrive as a prop from the section header's toggle; the
  // effects above re-apply scheme, fonts, and edits when it flips.
  useEffect(() => {
    applyMode(frameRef.current, mode);
  }, [mode]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <iframe
        ref={frameRef}
        src="/app"
        title="Live preview of your app"
        onLoad={handleLoad}
        className="block h-[600px] w-full"
      />
    </div>
  );
}
