export type ThemeFontChoice = {
  label: string;
  value: string | null;
  googleFamily?: string;
};

const GOOGLE_FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700&family=Figtree:wght@400..700&family=Geist:wght@400..700&family=Inter:wght@400..700&family=Nunito+Sans:wght@400..700&family=Outfit:wght@400..700&family=Roboto:wght@400..700&display=swap';

export const THEME_FONT_CHOICES: readonly ThemeFontChoice[] = [
  { label: 'Inter', value: null, googleFamily: 'Inter' },
  { label: 'Geist', value: "'Geist', ui-sans-serif, system-ui, sans-serif", googleFamily: 'Geist' },
  {
    label: 'Roboto',
    value: "'Roboto', ui-sans-serif, system-ui, sans-serif",
    googleFamily: 'Roboto',
  },
  {
    label: 'DM Sans',
    value: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
    googleFamily: 'DM Sans',
  },
  {
    label: 'Figtree',
    value: "'Figtree', ui-sans-serif, system-ui, sans-serif",
    googleFamily: 'Figtree',
  },
  {
    label: 'Nunito Sans',
    value: "'Nunito Sans', ui-sans-serif, system-ui, sans-serif",
    googleFamily: 'Nunito Sans',
  },
  {
    label: 'Outfit',
    value: "'Outfit', ui-sans-serif, system-ui, sans-serif",
    googleFamily: 'Outfit',
  },
  { label: 'System', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
];

const LINK_ID = 'admin-theme-google-font-preview';
const installations = new WeakMap<Document, { count: number; elements: HTMLElement[] }>();

function releaseThemePreviewFonts(target: Document): void {
  const current = installations.get(target);
  if (!current) return;
  current.count -= 1;
  if (current.count === 0) {
    for (const element of current.elements) element.remove();
    installations.delete(target);
  }
}

/** Install the temporary preview stylesheet into one document. The caller
    owns the returned cleanup, which keeps permanent font wiring in next/font. */
export function installThemePreviewFonts(target: Document): () => void {
  const installation = installations.get(target);
  if (installation) {
    installation.count += 1;
    return () => releaseThemePreviewFonts(target);
  }
  const preconnect = target.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = 'https://fonts.gstatic.com';
  preconnect.crossOrigin = 'anonymous';
  preconnect.dataset.themeFontPreview = 'preconnect';
  const stylesheet = target.createElement('link');
  stylesheet.id = LINK_ID;
  stylesheet.rel = 'stylesheet';
  stylesheet.href = GOOGLE_FONT_STYLESHEET;
  target.head.append(preconnect, stylesheet);
  const elements = [preconnect, stylesheet];
  installations.set(target, { count: 1, elements });
  return () => releaseThemePreviewFonts(target);
}

export function googleFontImportForValue(value: string | undefined): string | null {
  if (!value) return null;
  const choice = THEME_FONT_CHOICES.find(
    (candidate) => candidate.value !== null && candidate.value === value,
  );
  if (!choice?.googleFamily) return null;
  const family = choice.googleFamily.replaceAll(' ', '+');
  return `@import url("https://fonts.googleapis.com/css2?family=${family}:wght@400..700&display=swap");`;
}
