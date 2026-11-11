import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noSharedFeatureImport from '../../eslint-rules/no-shared-feature-import.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

const lib = '/repo/src/lib/workspace-event.ts';
const component = '/repo/src/components/providers/app-providers.tsx';

test('no-shared-feature-import', () => {
  ruleTester.run('no-shared-feature-import', noSharedFeatureImport, {
    valid: [
      { code: "import { chatStatusSchema } from './chat-status';", filename: lib },
      { code: "import { cn } from '@/lib/utils';", filename: component },
      { code: "import { Button } from '../ui/button';", filename: component },
      { code: "import { z } from 'zod';", filename: lib },
    ],
    invalid: [
      {
        code: "import { chatStatusSchema } from '@/features/sessions/lib/chat-status';",
        filename: lib,
        errors: [{ messageId: 'sharedFeatureImport' }],
      },
      {
        code: "import { openOverlay } from '@/features/overlays';",
        filename: component,
        errors: [{ messageId: 'sharedFeatureImport' }],
      },
      {
        code: "import { FileEntry } from '../features/files/types';",
        filename: lib,
        errors: [{ messageId: 'sharedFeatureImport' }],
      },
      {
        code: "export { feed } from '@/features/notifications/api/feed';",
        filename: lib,
        errors: [{ messageId: 'sharedFeatureImport' }],
      },
      {
        code: "const chat = await import('@/features/chat/lib/file-link');",
        filename: '/repo/src/hooks/use-thing.ts',
        errors: [{ messageId: 'sharedFeatureImport' }],
      },
    ],
  });
});
