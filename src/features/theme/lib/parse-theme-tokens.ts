import { AppError } from '@/lib/errors';
import type { ThemeToken, ThemeTokenGroup } from '../types';

const TOKEN_DECLARATION = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
const ROOT_BLOCK = /^:root\s*\{/gm;
const DARK_BLOCK = /^\.dark\s*\{/gm;
const THEME_BLOCK = /^@theme\s+inline\s*\{/gm;

// Exclude layout/motion roles rather than allowlisting colors, so new color families appear automatically.
const NON_COLOR_PREFIXES = [
  '--duration-',
  '--ease-',
  '--page-',
  '--section-',
  '--shadow-',
  '--sidebar-w',
  '--z-',
] as const;

function blocks(css: string, selector: RegExp, label: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const matches = [...source.matchAll(selector)];
  if (matches.length === 0) {
    throw new AppError('UNEXPECTED', `Could not parse the ${label} block in globals.css.`, {
      block: label,
    });
  }

  return matches.map((match, index) => {
    const openingBrace = source.indexOf('{', match.index);
    let depth = 0;
    for (let cursor = openingBrace; cursor < source.length; cursor += 1) {
      if (source[cursor] === '{') depth += 1;
      if (source[cursor] === '}') depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, cursor);
    }

    const numberedLabel = matches.length > 1 ? `${label} ${index + 1}` : label;
    throw new AppError('UNEXPECTED', `Could not parse the ${numberedLabel} block in globals.css.`, {
      block: numberedLabel,
    });
  });
}

function declarations(block: string): Array<{ name: string; value: string }> {
  return [...block.matchAll(TOKEN_DECLARATION)].flatMap((match) => {
    const name = match.at(1);
    const value = match.at(2);
    if (name === undefined || value === undefined) return [];
    return [{ name, value: value.replace(/\/\*[\s\S]*?\*\//g, '').trim() }];
  });
}

function rootGroupFor(name: string, value: string): ThemeTokenGroup | undefined {
  if (name.startsWith('--radius')) return 'Radius';
  if (name.startsWith('--font-') || name.startsWith('--text-')) return 'Type';
  if (NON_COLOR_PREFIXES.some((prefix) => name.startsWith(prefix))) return undefined;
  // Derived mappings (pure var() references) are edited through their
  // underlying token, not directly.
  if (/^var\(--[\w-]+\)$/.test(value)) return undefined;
  return 'Colors';
}

function inlineThemeGroupFor(name: string): ThemeTokenGroup | undefined {
  if (name.startsWith('--radius')) return 'Radius';
  if (name.startsWith('--font-') || name.startsWith('--text-')) return 'Type';
  return undefined;
}

export function parseThemeTokens(css: string): ThemeToken[] {
  const rootBlocks = blocks(css, ROOT_BLOCK, ':root');
  const darkBlocks = blocks(css, DARK_BLOCK, '.dark');
  const themeBlocks = blocks(css, THEME_BLOCK, '@theme inline');

  const darkValues = new Map(
    darkBlocks.flatMap(declarations).map(({ name, value }) => [name, value]),
  );

  const seen = new Set<string>();
  const candidates = [
    ...rootBlocks.flatMap(declarations).map((declaration) => ({
      ...declaration,
      group: rootGroupFor(declaration.name, declaration.value),
    })),
    ...themeBlocks.flatMap(declarations).map((declaration) => ({
      ...declaration,
      group: inlineThemeGroupFor(declaration.name),
    })),
  ];

  return candidates.flatMap(({ name, value, group }) => {
    if (!group || seen.has(name)) return [];
    seen.add(name);
    return [{ name, value, darkValue: darkValues.get(name), group }];
  });
}
