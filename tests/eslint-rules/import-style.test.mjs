import { test } from 'node:test';
import { RuleTester } from 'eslint';
import importStyle from '../../eslint-rules/import-style.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});
const chatFile = '/repo/src/features/chat/lib/tool-activity.ts';
const libFile = '/repo/src/lib/route-kit.ts';

test('import-style', () => {
  ruleTester.run('import-style', importStyle, {
    valid: [
      { filename: chatFile, code: "import { x } from './chat-store';" },
      { filename: chatFile, code: "import { x } from '../hooks/use-chat-send';" },
      { filename: chatFile, code: "import { plural } from '@/lib/format/plural';" },
      { filename: libFile, code: "import { log } from './logger';" },
      { filename: chatFile, code: "import { z } from 'zod';" },
      { filename: '/repo/scripts/seed.ts', code: "import { x } from '../src/lib/env.ts';" },
    ],
    invalid: [
      {
        filename: chatFile,
        code: "import { plural } from '../../../lib/format/plural.ts';",
        output: "import { plural } from '@/lib/format/plural';",
        errors: [{ messageId: 'style' }],
      },
      {
        filename: chatFile,
        code: "import { retry } from './custom-tool-dispatch-retry.ts';",
        output: "import { retry } from './custom-tool-dispatch-retry';",
        errors: [{ messageId: 'style' }],
      },
      {
        filename: '/repo/src/features/agent-setup/lib/seed-diff.ts',
        code: "export { BUILTIN } from '../../tool-catalog/builtin-tools.ts';",
        output: "export { BUILTIN } from '@/features/tool-catalog/builtin-tools';",
        errors: [{ messageId: 'style' }],
      },
      {
        filename: libFile,
        code: "const env = await import('@/lib/env.ts');",
        output: "const env = await import('@/lib/env');",
        errors: [{ messageId: 'style' }],
      },
    ],
  });
});
