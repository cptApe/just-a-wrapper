import { join } from 'node:path';
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import nextTs from 'eslint-config-next/typescript';
import noRawColorLiterals from '../../eslint-rules/no-raw-color-literals.mjs';

const typescriptParser = nextTs.find((config) => config.languageOptions?.parser)?.languageOptions
  ?.parser;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    parser: typescriptParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

test('no-raw-color-literals refuses raw, bare, retired and unknown colour and radius classes', () => {
  ruleTester.run('no-raw-color-literals', noRawColorLiterals, {
    valid: [
      { code: '<p className="text-primary text-title-card text-center text-balance" />;' },
      {
        code: '<div className="bg-cover bg-center bg-gradient-to-r from-primary/20 to-transparent" />;',
      },
      {
        code: '<div className="border-x border-dashed divide-y outline-none ring-inset fill-current" />;',
      },

      '<div className="bg-success text-foreground" />;',
      '<div className="border-warning/40 bg-warning/10 text-warning" />;',
      'const issue = "#173";',
      'const state = "bg-red-500"; console.log(state);',
      'const state = "bg-red-500"; const value = <div>{state}</div>;',
      'const state = "bg-red-500"; function Demo() { const state = "bg-success"; return <div className={state} />; } console.log(state);',
      '<div style={{ color: "var(--foreground)" }} />;',
      '<div className="bg-primary/90 text-primary-foreground" />;',
      '<div className="bg-alpha-6 text-glass-fg ring-success-strong" />;',
      '<div className="bg-overlay text-on-media" />;',
      '<div className="bg-transparent text-current fill-inherit" />;',
      '<div className="dark:bg-card dark:text-muted-foreground" />;',
      '<div className="rounded-sm rounded-t-md rounded-lg rounded-xl rounded-full" />;',
      '<div className="rounded-[inherit] rounded-[2px] rounded-tl-[3px]" />;',
      '<div className="text-accent-foreground bg-sidebar-accent" />;',
      {
        code: '<div className="bg-[#fff]" />;',
        filename: join(process.cwd(), 'src/app/opengraph-image.tsx'),
        options: [
          {
            allowFiles: [
              {
                path: 'src/app/opengraph-image.tsx',
                reason: 'Raster image colors',
              },
            ],
          },
        ],
      },
      {
        code: '<div className="fill-white" />;',
        filename: join(process.cwd(), 'src/components/icons/brand/index.tsx'),
        options: [
          {
            allowFiles: [
              {
                path: 'src/components/icons/',
                reason: 'Fixed brand mark colors',
              },
            ],
          },
        ],
      },
    ],
    invalid: [
      {
        code: '<div className="bg-[#fff]" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="border-emerald-600/40 bg-emerald-600/10 text-emerald-700" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="dark:hover:bg-sky-950/60 text-white" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="outline-red-500 caret-blue-500 accent-green-500 decoration-sky-500 ring-offset-amber-500 border-x-rose-500" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="bg-linear-to-b from-violet-500 via-purple-500 to-fuchsia-500" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="text-[hsl(0_0%_0%)]" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="shadow-[0_1px_2px_rgb(0_0_0/0.04)]" />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div style={{ color: "rgb(0 0 0)" }} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<svg><path fill="#fff" /></svg>;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const red = "#fff"; const value = <div style={{ color: red }} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const state = "bg-red-500"; const value = <div className={state} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const TONE_STYLES = { destructive: "border-destructive/30", warning: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700" } as const; const tone: keyof typeof TONE_STYLES = "warning"; const value = <div className={`base ${TONE_STYLES[tone]}`} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const STATES = ["bg-success", ["text-sky-700"]]; const value = <div className={STATES.flat().join(" ")} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: '<div className="bg-[#fff]" />;',
        filename: join(process.cwd(), 'nested/src/app/opengraph-image.tsx'),
        options: [
          {
            allowFiles: [
              {
                path: 'src/app/opengraph-image.tsx',
                reason: 'Raster image colors',
              },
            ],
          },
        ],
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const hue = 20; const value = <div style={{ color: `hsl(${hue} 50% 50%)` }} />;',
        errors: [{ messageId: 'rawColor' }],
      },
      {
        code: 'const canvas = document.createElement("canvas"); canvas.className = "w-full rounded-lg border bg-white";',
        errors: [{ messageId: 'bareColor', data: { name: 'bg-white' } }],
      },
      {
        code: '<div className="text-black" />;',
        errors: [{ messageId: 'bareColor', data: { name: 'text-black' } }],
      },
      {
        code: '<div className={cn("absolute inset-0 bg-black/60")} />;',
        errors: [{ messageId: 'bareColor', data: { name: 'bg-black/60' } }],
      },
      {
        code: '<div className="ring-white" />;',
        errors: [{ messageId: 'bareColor', data: { name: 'ring-white' } }],
      },
      {
        code: '<div className="bg-surface-1" />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'surface-1', replacement: 'card' },
          },
        ],
      },
      {
        code: '<span className="size-4 text-brand-solid" />;',
        errors: [{ messageId: 'unknownToken', data: { name: 'text-brand-solid' } }],
      },
      {
        code: '<div className="dark:hover:bg-surface-hover/50" />;',
        errors: [{ messageId: 'unknownToken', data: { name: 'bg-surface-hover' } }],
      },
      {
        code: '<div className="h-4 w-24 rounded bg-alpha-8" />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'rounded', replacement: 'rounded-sm' },
          },
        ],
      },
      {
        code: '<div className="hover:bg-surface-2/80" />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'surface-2', replacement: 'popover' },
          },
        ],
      },
      {
        code: '<div className="rounded-xs" />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'rounded-xs', replacement: 'rounded-sm' },
          },
        ],
      },
      {
        code: '<div className="sm:rounded-t-3xl" />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'rounded-t-3xl', replacement: 'rounded-t-xl' },
          },
        ],
      },
      {
        code: '<div className="rounded-[14px]" />;',
        errors: [{ messageId: 'arbitraryRadius', data: { name: 'rounded-[14px]' } }],
      },
      {
        code: '<div className="rounded-b-[var(--radius-card)]" />;',
        errors: [
          {
            messageId: 'arbitraryRadius',
            data: { name: 'rounded-b-[var(--radius-card)]' },
          },
        ],
      },
      {
        code: 'const CARD = "rounded-2xl bg-card"; const value = <div className={CARD} />;',
        errors: [
          {
            messageId: 'retiredToken',
            data: { name: 'rounded-2xl', replacement: 'rounded-xl' },
          },
        ],
      },
    ],
  });
});
