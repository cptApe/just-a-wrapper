import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseThemeTokens } from '../../src/features/theme/lib/parse-theme-tokens.ts';
import { globalsCss } from './globals-css.mjs';

const colorValue =
  /^(?:-?[\d.]+(?:deg|grad|rad|turn)?\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*[\d.]+%?)?|(?:color|color-mix|hsla?|hwb|lab|lch|light-dark|oklab|oklch|rgba?)\([\s\S]+\)|#[\da-f]{3,8}|currentColor|transparent)$/i;

test('the shipped stylesheet opens in the theme editor with every colour editable in both themes', () => {
  const tokens = parseThemeTokens(globalsCss);
  assert.equal(new Set(tokens.map((token) => token.name)).size, tokens.length);
  for (const [name, group] of [
    ['--destructive-hsl', 'Colors'],
    ['--radius-lg', 'Radius'],
    ['--text-body', 'Type'],
  ])
    assert.ok(
      tokens.some((token) => token.name === name && token.group === group),
      name,
    );
  for (const token of tokens.filter((row) => row.group === 'Colors')) {
    assert.match(token.value, colorValue, token.name);
    if (token.darkValue !== undefined) assert.match(token.darkValue, colorValue, token.name);
  }
});

test('a fork stylesheet with new roles and several theme blocks parses, and a broken one names its block', () => {
  assert.deepEqual(
    parseThemeTokens(`
:root { --new-palette-role: 10 20% 30%; --duration-fast: 100ms; }
.dark { --new-palette-role: 10 20% 70%; }
@theme inline { --text-first: 12px; }
@theme inline { @keyframes nested { from { opacity: 0; } to { opacity: 1; } } --text-second: 14px; }
`),
    [
      { name: '--new-palette-role', value: '10 20% 30%', darkValue: '10 20% 70%', group: 'Colors' },
      { name: '--text-first', value: '12px', darkValue: undefined, group: 'Type' },
      { name: '--text-second', value: '14px', darkValue: undefined, group: 'Type' },
    ],
  );
  for (const css of [
    ':root { --accent: red; }\n.dark { --accent: blue; }',
    ':root { --accent: red; }\n.dark { --accent: blue; }\n@theme inline { --text-body: 15px;\n',
  ])
    assert.throws(
      () => parseThemeTokens(css),
      (error) => error.code === 'UNEXPECTED' && error.context.block === '@theme inline',
    );
});
