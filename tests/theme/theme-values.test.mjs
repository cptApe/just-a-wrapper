// The theme editor's values and colour cascade: a pick must land where the admin made it and
// never write broken CSS or unreadable text.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cascadeNamedColor,
  resolvedThemeValue,
} from '../../src/features/theme/lib/theme-cascade.ts';
import {
  createThemeResolver,
  EMPTY_THEME_EDIT_VALUES,
  effectiveThemeOverrides,
  effectiveTokenValue,
  hasThemeEdits,
  themeTokenChanges,
  withTokenValue,
} from '../../src/features/theme/lib/theme-values.ts';
import { themeColorContrastRatio } from './color-contrast.mjs';

const TOKENS = [
  { name: '--neutral-0', value: '0 0% 100%', darkValue: '0 0% 7%', group: 'Colors' },
  {
    name: '--background',
    value: 'hsl(var(--neutral-0))',
    darkValue: 'hsl(var(--neutral-0))',
    group: 'Colors',
  },
  { name: '--accent-50', value: '103 45% 30%', darkValue: '95 65% 62%', group: 'Colors' },
  { name: '--glass-fg', value: 'hsl(0 0% 100%)', group: 'Colors' },
  { name: '--radius-lg', value: '12px', group: 'Radius' },
  { name: '--radius', value: 'var(--radius-lg)', group: 'Radius' },
];
const byName = (name) => TOKENS.find((token) => token.name === name);
const cascade = (tokens, tokenName, companionNames, color, mode = 'light') =>
  cascadeNamedColor({
    tokens,
    values: EMPTY_THEME_EDIT_VALUES,
    mode,
    tokenName,
    companionNames,
    color,
  });

test('a light edit shows in dark only where the token has no dark value of its own', () => {
  const glass = byName('--glass-fg');
  const neutral = byName('--neutral-0');
  const lightEdited = { light: { '--glass-fg': 'red', '--neutral-0': '1 1% 1%' }, dark: {} };
  assert.equal(effectiveTokenValue(glass, lightEdited, 'dark'), 'red');
  assert.equal(effectiveTokenValue(neutral, lightEdited, 'dark'), '0 0% 7%');
  assert.deepEqual(effectiveThemeOverrides(TOKENS, lightEdited, 'dark'), { '--glass-fg': 'red' });
});

test('edits are stored only where they differ, and a dark edit is never lost to the light one', () => {
  const neutral = byName('--neutral-0');
  const edited = withTokenValue(EMPTY_THEME_EDIT_VALUES, 'light', neutral, '0 0% 99%');
  assert.deepEqual(edited, { light: { '--neutral-0': '0 0% 99%' }, dark: {} });
  const restored = withTokenValue(edited, 'light', neutral, '0 0% 100%');
  assert.equal(hasThemeEdits(restored), false);

  // --glass-fg has no dark line, so dark shows the light override.
  const glass = byName('--glass-fg');
  const lightEdited = withTokenValue(EMPTY_THEME_EDIT_VALUES, 'light', glass, 'red');
  assert.deepEqual(withTokenValue(lightEdited, 'dark', glass, 'red').dark, {});
  const darkEdited = withTokenValue(lightEdited, 'dark', glass, 'blue');
  assert.equal(effectiveTokenValue(glass, darkEdited, 'dark'), 'blue');
  assert.equal(effectiveTokenValue(glass, darkEdited, 'light'), 'red');
  const darkToBaseline = withTokenValue(lightEdited, 'dark', glass, 'hsl(0 0% 100%)');
  assert.deepEqual(darkToBaseline.dark, { '--glass-fg': 'hsl(0 0% 100%)' });
  assert.deepEqual(themeTokenChanges(TOKENS, darkToBaseline), [
    { name: '--glass-fg', group: 'Colors', mode: 'light', from: 'hsl(0 0% 100%)', to: 'red' },
  ]);
});

test('the resolver follows var() chains per theme and never leaks an unresolved var()', () => {
  const resolver = createThemeResolver(TOKENS);
  assert.equal(resolver.resolve('hsl(var(--neutral-0))', 'dark'), 'hsl(0 0% 7%)');
  assert.equal(resolver.resolve('hsl(var(--accent-50) / 0.16)', 'dark'), 'hsl(95 65% 62% / 0.16)');
  assert.equal(resolver.resolveToken('--background', 'dark'), 'hsl(0 0% 7%)');
  assert.equal(resolver.resolveToken('--radius', 'light'), '12px');
  const broken = [{ name: '--accent', value: 'hsl(var(--missing))', group: 'Colors' }];
  assert.equal(resolvedThemeValue(broken, EMPTY_THEME_EDIT_VALUES, 'light', '--accent'), undefined);
});

test('picking a colour moves its companions and writes dark picks only to dark', () => {
  const tokens = [
    { name: '--accent-50', value: '100 50% 30%', group: 'Colors' },
    { name: '--accent', value: 'hsl(var(--accent-50))', group: 'Colors' },
    { name: '--accent-soft', value: 'hsl(var(--accent-50) / 0.12)', group: 'Colors' },
    { name: '--accent-foreground', value: 'hsl(0 0% 100%)', group: 'Colors' },
  ];
  const companions = ['--accent-50', '--accent-soft', '--accent-foreground'];
  const light = cascade(tokens, '--accent', companions, 'rgb(255 0 0)');
  assert.equal(light.light['--accent'], 'hsl(0 100% 50%)');
  assert.equal(light.light['--accent-50'], '0 100% 50%');
  assert.equal(light.light['--accent-soft'], 'hsl(0 100% 50% / 0.12)');
  const darkTokens = [
    { name: '--accent', value: 'hsl(100 40% 30%)', darkValue: 'hsl(100 60% 65%)', group: 'Colors' },
    {
      name: '--accent-soft',
      value: 'hsl(100 40% 30% / 0.12)',
      darkValue: 'hsl(100 60% 65% / 0.16)',
      group: 'Colors',
    },
  ];
  const dark = cascade(darkTokens, '--accent', ['--accent-soft'], 'hsl(200 70% 55%)', 'dark');
  assert.deepEqual(dark.light, {});
  assert.equal(dark.dark['--accent-soft'], 'hsl(200 70% 55% / 0.16)');
});

test('any picked colour keeps its label text readable', () => {
  const families = [
    { base: '--accent', foreground: '--accent-foreground', baseline: '103 45% 30%', min: 4.5 },
    {
      base: '--destructive',
      foreground: '--destructive-foreground',
      baseline: '4 84% 60%',
      min: 3,
    },
    {
      base: '--foreground',
      surface: '--primary',
      foreground: '--primary-foreground',
      baseline: '0 0% 8%',
      min: 3,
    },
  ];
  for (const family of families) {
    const tokens = [
      { name: family.base, value: `hsl(${family.baseline})`, group: 'Colors' },
      ...(family.surface
        ? [{ name: family.surface, value: `hsl(${family.baseline})`, group: 'Colors' }]
        : []),
      { name: family.foreground, value: 'hsl(0 0% 100%)', group: 'Colors' },
    ];
    const token = (name) => tokens.find((row) => row.name === name);
    const companions = [...(family.surface ? [family.surface] : []), family.foreground];
    for (const pick of ['hsl(45 90% 88%)', 'hsl(220 70% 14%)', 'hsl(0 0% 50%)']) {
      const values = cascade(tokens, family.base, companions, pick);
      const ratio = themeColorContrastRatio(
        effectiveTokenValue(token(family.surface ?? family.base), values, 'light'),
        effectiveTokenValue(token(family.foreground), values, 'light'),
      );
      assert.ok(ratio >= family.min, `${family.foreground} contrast ${ratio} for ${pick}`);
    }
  }
});

test('grey, translucent and odd baseline picks never write NaN, Infinity or a stray alpha', () => {
  const grey = cascade(
    [
      { name: '--muted-foreground', value: 'hsl(0 0% 46%)', group: 'Colors' },
      { name: '--companion', value: 'hsl(120 0% 36%)', group: 'Colors' },
    ],
    '--muted-foreground',
    ['--companion'],
    'hsl(280 0% 60%)',
  );
  assert.equal(grey.light['--companion'], 'hsl(0 0% 50%)');
  const channels = cascade(
    [
      { name: '--success', value: 'hsl(var(--success-hsl))', group: 'Colors' },
      { name: '--success-hsl', value: '152 38% 34%', group: 'Colors' },
    ],
    '--success',
    ['--success-hsl'],
    'rgb(20 80 40 / 0.4)',
  );
  assert.match(channels.light['--success-hsl'], /^\d[^/]*$/);
  const zeroAlpha = cascade(
    [
      { name: '--success', value: 'hsl(140 50% 30% / 0)', group: 'Colors' },
      { name: '--success-soft', value: 'hsl(140 50% 30% / 0.2)', group: 'Colors' },
    ],
    '--success',
    ['--success-soft'],
    'hsl(160 60% 40% / 0.4)',
  );
  assert.equal(zeroAlpha.light['--success-soft'], 'hsl(160 60% 40% / 0.08)');
  const p3 = cascade(
    [{ name: '--accent', value: 'color(display-p3 0.1 0.2 0.3)', group: 'Colors' }],
    '--accent',
    [],
    'rgb(255 0 0)',
  );
  assert.equal(p3.light['--accent'], 'hsl(0 100% 50%)');
});
