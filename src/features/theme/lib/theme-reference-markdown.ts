import {
  BUTTON_RADIUS_CHOICES,
  BUTTON_RADIUS_TOKEN,
  CORNER_RADIUS_CHOICES,
  NAMED_THEME_COLORS,
  RADIUS_BASE_TOKEN,
} from '../constants';
import type { ThemeMode, ThemeToken } from '../types';
import { createThemeResolver } from './theme-values';

// Markdown mirrors the theme editor’s edit steps, swatches, font and corner size.

const LOOK_COLUMNS = NAMED_THEME_COLORS;

function cell(value: string): string {
  return `\`${value.replace(/\|/g, '\\|')}\``;
}

function fontName(value: string): string {
  const variableName = value.match(/var\(--font-([a-z0-9-]+)\)/)?.[1];
  const [first = ''] = value.split(',', 1);
  const family = variableName ?? first.replace(/["']/g, '').trim();
  return family
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function themeReferenceMarkdown(tokens: readonly ThemeToken[]): string {
  const resolver = createThemeResolver(tokens);
  const font = tokens.find((token) => token.name === '--font-sans');

  const row = (mode: ThemeMode): string => {
    const values = LOOK_COLUMNS.map((column) => {
      const value = resolver.resolveToken(column.token, mode);
      return value ? cell(value) : 'Not set';
    });
    const family = font ? fontName(font.value) : 'Not set';
    const cornerValue = resolver.resolveToken(RADIUS_BASE_TOKEN, mode)?.trim();
    const corner =
      cornerValue === undefined
        ? 'Not set'
        : (CORNER_RADIUS_CHOICES.find((choice) => choice.value === cornerValue)?.label ??
          cornerValue);
    const buttonValue = resolver.resolveToken(BUTTON_RADIUS_TOKEN, mode)?.trim();
    const buttons =
      buttonValue === undefined
        ? 'Not set'
        : (BUTTON_RADIUS_CHOICES.find((choice) => choice.value === buttonValue)?.label ??
          buttonValue);
    const label = mode === 'light' ? 'Light' : 'Dark';
    return `| ${label} | ${values.join(' | ')} | ${family} | ${corner} | ${buttons} |`;
  };

  const header = LOOK_COLUMNS.map((column) => column.label).join(' | ');
  const divider = Array.from({ length: LOOK_COLUMNS.length + 4 }, () => '---').join('|');

  return [
    '# Theme',
    'Choose named colors, radii, and fonts on the page, or edit them inside your real app.',
    'Open `/admin/theme` and choose **Edit**.',
    '## Your look today',
    `| Look | ${header} | Font | Corner radius | Button radius |\n|${divider}|\n${row('light')}\n${row('dark')}`,
    'The prompt you copy on save carries the exact token values.',
    'The page below the cards previews the real app in either theme.',
  ].join('\n\n');
}
