import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';
import wrapperRules from './eslint-rules/index.mjs';
import {
  BRAND_ENV_KEYS,
  INLINED_PUBLIC_ENV_KEYS,
  PLATFORM_ENV_KEYS,
} from './eslint-rules/no-raw-env-read.mjs';
import {
  FLOATING_PANEL_TRANSITION,
  INTEGRATION_MOCKS,
  NO_UPGRADE_PAGE,
  RAW_API_FETCH,
  RAW_POSTHOG_CAPTURE,
  RETIRED_TOOLS_FACETS,
  SOURCE_TEXT_IN_TESTS,
} from './eslint-rules/restricted-syntax.mjs';

// The lint cache keys on the resolved config, which does not include rule source or rule data
// files. A digest of eslint-rules/ in settings makes any change there invalidate the cache.
const rulesDir = new URL('./eslint-rules/', import.meta.url);
const rulesDigest = createHash('sha256');
for (const name of readdirSync(rulesDir).sort()) {
  rulesDigest.update(name).update(readFileSync(new URL(name, rulesDir)));
}

const LUCIDE_IMPORTS = {
  group: ['lucide-react', 'lucide-react/*'],
  message: 'Icons come from @/components/icons (Untitled UI): see docs/spec/08-design-system.md.',
};
const BRAND_CONTENT_IMPORTS = {
  group: ['@content/brand'],
  message:
    'Read the brand through @/lib/brand/identity (build-time values) or @/lib/brand/contact (run-time contact details): see docs/decisions/0048-brand-and-contact-come-from-configuration.md.',
};

const eslintConfig = defineConfig([
  { settings: { 'just-a-wrapper/rules-digest': rulesDigest.digest('hex') } },
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    'output/**',
    // Dot directories hold build output and local tool state, not source.
    '.*/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    'src/db/migrations/**',
    'tests/eslint-rules/**',
  ]),
  {
    // Every export of a 'use server' file is a public endpoint and needs a boundary.
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: { 'just-a-wrapper/require-action-boundary': 'error' },
  },
  {
    // Routes depend on a feature's public entries. Local-only dev routes are never deployed.
    files: ['src/app/api/**/*.ts'],
    ignores: ['src/app/api/dev/**'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: { 'just-a-wrapper/no-deep-feature-import': 'error' },
  },
  {
    // Shared layers sit below every feature (code standard 6.2).
    files: [
      'src/lib/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/db/**/*.{ts,tsx}',
    ],
    // Better Auth takes its hooks in one config object, so this file wires billing, notifications and workspaces.
    ignores: ['src/lib/auth.ts'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: { 'just-a-wrapper/no-shared-feature-import': 'error' },
  },
  {
    // One way to write an import path in application code (code standard, imports).
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: { 'just-a-wrapper/import-style': 'error' },
  },
  {
    // A feature imports only lower layers of eslint-rules/feature-layers.mjs (decision 0040).
    files: ['src/features/**/*.{ts,tsx}'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: { 'just-a-wrapper/no-upward-feature-import': 'error' },
  },
  {
    // Server data reaches the browser through React Query (code standard 5.3, decision 0044).
    files: ['src/features/**/*.{ts,tsx}'],
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: {
      'just-a-wrapper/no-effect-fetch': [
        'error',
        {
          allow: [
            {
              path: 'src/features/chat/hooks/use-relay-connection.ts',
              reason:
                'A stream: the event source and its access probe live and die with the open task.',
            },
            {
              path: 'src/features/billing/components/billing-return.tsx',
              reason:
                'Arriving back from Stripe is the event: the page consumes the return once and reconciles it.',
            },
            {
              path: 'src/features/tools/components/browser-session-overlay.tsx',
              reason:
                'A live remote browser: a bounded status poll and a control lease heartbeat tied to the open view.',
            },
          ],
        },
      ],
    },
  },
  {
    plugins: { 'just-a-wrapper': wrapperRules },
    rules: {
      'just-a-wrapper/no-silent-catch': 'error',
      'just-a-wrapper/no-machine-status-write': 'error',
      'just-a-wrapper/suppression-requires-reason': 'error',
      // Self-guards to src/app/api/**/route.ts files; a no-op elsewhere.
      'just-a-wrapper/require-request-context': 'error',
      'no-restricted-imports': ['error', { patterns: [LUCIDE_IMPORTS, BRAND_CONTENT_IMPORTS] }],
    },
  },
  {
    // The brand module is the one reader of the committed brand facts and placeholders.
    files: ['src/lib/brand/**', 'src/lib/deployment-settings/registry.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [LUCIDE_IMPORTS] }] },
  },
  {
    // App source only. `no-bare-error-throw` (every throw is an AppError
    // subclass), the raw-`/api/`-fetch ban, and the analytics capture funnel
    // (10 §2) are product-code invariants; they deliberately do NOT apply to
    // scripts/** and tests/**, which throw plain Errors and probe endpoints
    // with raw fetch by design. Flat config does not merge
    // `no-restricted-syntax` across blocks, so both lists are built from the
    // groups in eslint-rules/restricted-syntax.mjs; the analytics block below
    // leaves out only the capture ban (last match wins per rule).
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'just-a-wrapper/no-bare-error-throw': 'error',
      'just-a-wrapper/no-journal-comments': 'error',
      'just-a-wrapper/no-raw-color-literals': [
        'error',
        {
          allowFiles: [
            {
              path: 'src/app/opengraph-image.tsx',
              reason:
                'The Open Graph raster uses fixed brand colors outside the application theme.',
            },
            {
              path: 'src/app/global-error.tsx',
              reason: 'The root error fallback must render before globals.css is available.',
            },
            {
              path: 'src/features/auth/components/auth-form.tsx',
              reason: 'The Google sign-in glyph keeps its brand colors.',
            },
            {
              path: 'src/features/auth/components/showcase-panel.tsx',
              reason:
                'The login showcase cards deliberately demonstrate varied decorative palettes.',
            },
            {
              path: 'src/features/theme/components/theme-switcher.tsx',
              reason:
                'The switch knob uses a deliberate off-scale optical shadow with no matching token.',
            },
            {
              path: 'src/components/settings/settings-avatar-hero.tsx',
              reason:
                'Avatar colors derive from identity hue, and its loading controls use fixed media-overlay contrast.',
            },
          ],
        },
      ],
      // Every value a person reads is formatted by src/lib/format/ (decision 0043). These files
      // use Intl for zone math, validation or locale probes, never for display.
      'just-a-wrapper/no-raw-intl-format': [
        'error',
        {
          allowFiles: [
            {
              path: 'src/features/preferences/lib/time-preferences.ts',
              reason: 'Validates zones, reads the browser zone and probes a locale hour cycle.',
            },
            {
              path: 'src/features/tasks/lib/validate-schedule.ts',
              reason: 'Validates a schedule time zone.',
            },
            {
              path: 'src/features/tasks/lib/zoned-date-parts.ts',
              reason: 'Reads numeric wall-clock parts in a zone for schedule math.',
            },
            {
              path: 'src/features/scheduled/lib/one-time-input.ts',
              reason: 'Builds and parses the date-time input value across DST.',
            },
            {
              path: 'src/features/chat/lib/greeting.ts',
              reason: 'Reads the hour in a zone to pick a greeting; nothing is displayed.',
            },
          ],
        },
      ],
      'just-a-wrapper/no-stray-console': 'error',
      'just-a-wrapper/no-direct-session-read': 'error',
      'just-a-wrapper/require-form-primitive': 'error',
      'no-restricted-syntax': [
        'error',
        ...RAW_API_FETCH,
        ...RAW_POSTHOG_CAPTURE,
        ...FLOATING_PANEL_TRANSITION,
        ...NO_UPGRADE_PAGE,
        ...RETIRED_TOOLS_FACETS,
      ],
    },
  },
  {
    // Configuration is read through @/lib/env, so /admin/environment lists every key. env.ts and
    // env-schema.ts build that schema from process.env themselves.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/env.ts', 'src/lib/env-schema.ts'],
    rules: {
      'just-a-wrapper/no-raw-env-read': [
        'error',
        { allow: [...PLATFORM_ENV_KEYS, ...INLINED_PUBLIC_ENV_KEYS] },
      ],
    },
  },
  {
    files: ['src/lib/brand/identity.ts'],
    rules: {
      'just-a-wrapper/no-raw-env-read': [
        'error',
        { allow: [...PLATFORM_ENV_KEYS, ...INLINED_PUBLIC_ENV_KEYS, ...BRAND_ENV_KEYS] },
      ],
    },
  },
  {
    // These files own the raw auth session: the two resolvers, and the code that moves the
    // active-organization pointer itself (provisioning, switching, accepting an invitation).
    files: [
      'src/lib/caller.ts',
      'src/lib/request-session.ts',
      'src/features/workspaces/api/ensure-personal-workspace.ts',
      'src/features/workspaces/api/active-organization-transitions.ts',
      'src/features/workspaces/api/invitation-actions.ts',
    ],
    rules: {
      'just-a-wrapper/no-direct-session-read': 'off',
    },
  },
  {
    // These files implement the structured capture sinks or exist only behind
    // development-only routes, where console output is the intended boundary.
    files: [
      'src/lib/observability.ts',
      'src/lib/observability-client.ts',
      'src/app/api/dev/**/*.{ts,tsx}',
    ],
    rules: {
      'just-a-wrapper/no-stray-console': 'off',
    },
  },
  {
    // The analytics helpers and client init are the capture funnel, so raw
    // posthog.capture is legal here: this list drops only that group.
    files: ['src/lib/analytics-client.ts', 'src/lib/analytics.ts', 'src/instrumentation-client.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RAW_API_FETCH,
        ...FLOATING_PANEL_TRANSITION,
        ...NO_UPGRADE_PAGE,
        ...RETIRED_TOOLS_FACETS,
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/ban-ts-comment': 'error',
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  { files: ['src/components/icons/**'], rules: { 'max-lines': 'off' } },
  {
    // Tests prove behaviour; they never match text in a src/ file (decision 0012).
    files: ['tests/**/*.{mjs,ts}'],
    // Feeds the real stylesheet to the production theme parser and to Tailwind.
    ignores: ['tests/theme/globals-css.mjs'],
    rules: { 'no-restricted-syntax': ['error', ...SOURCE_TEXT_IN_TESTS] },
  },
  {
    // Integration tests run app code on the real test database and replace only the listed seams.
    files: ['tests/integration/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...SOURCE_TEXT_IN_TESTS, ...INTEGRATION_MOCKS] },
  },
]);

export default eslintConfig;
