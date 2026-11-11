import { join } from 'node:path';
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noRawIntlFormat from '../../eslint-rules/no-raw-intl-format.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

const feature = join(process.cwd(), 'src/features/chat/components/message.tsx');

test('no-raw-intl-format', () => {
  ruleTester.run('no-raw-intl-format', noRawIntlFormat, {
    valid: [
      { code: 'formatDate(at, timeZone);', filename: feature },
      { code: 'name.toLocaleLowerCase();', filename: feature },
      { code: 'Intl.supportedValuesOf("timeZone");', filename: feature },
      { code: 'Intl.ListFormat;', filename: feature },
      {
        code: 'new Intl.DateTimeFormat("en-US", { timeZone }).format(at);',
        filename: join(process.cwd(), 'src/lib/format/format-date.ts'),
      },
      {
        code: 'new Intl.DateTimeFormat("en-CA", { timeZone }).formatToParts(at);',
        filename: join(process.cwd(), 'src/features/tasks/lib/zoned-date-parts.ts'),
        options: [
          {
            allowFiles: [
              { path: 'src/features/tasks/lib/zoned-date-parts.ts', reason: 'Schedule math.' },
            ],
          },
        ],
      },
    ],
    invalid: [
      {
        code: 'new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(at);',
        filename: feature,
        errors: [{ messageId: 'rawIntl' }],
      },
      {
        code: 'new Intl.NumberFormat("en-US").format(n);',
        filename: feature,
        errors: [{ messageId: 'rawIntl' }],
      },
      {
        code: 'Intl["RelativeTimeFormat"];',
        filename: feature,
        errors: [{ messageId: 'rawIntl' }],
      },
      {
        code: 'count.toLocaleString("en-US");',
        filename: feature,
        errors: [{ messageId: 'rawLocale' }],
      },
      {
        code: 'at.toLocaleDateString();',
        filename: feature,
        errors: [{ messageId: 'rawLocale' }],
      },
      {
        // A nested folder named like the home is not the home.
        code: 'n.toLocaleString();',
        filename: join(process.cwd(), 'nested/src/lib/format/format-count.ts'),
        errors: [{ messageId: 'rawLocale' }],
      },
    ],
  });
});
