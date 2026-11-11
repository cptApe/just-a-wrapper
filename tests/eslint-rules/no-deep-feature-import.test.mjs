import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noDeepFeatureImport from '../../eslint-rules/no-deep-feature-import.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('no-deep-feature-import', () => {
  ruleTester.run('no-deep-feature-import', noDeepFeatureImport, {
    valid: [
      "import { authorizeSessionAccess } from '@/features/sessions';",
      "import { readFileContent } from '@/features/files/server';",
      "import { withApiRoute } from '@/lib/route-kit';",
      "import { z } from 'zod';",
    ],
    invalid: [
      {
        code: "import { dispatchRequest } from '@/features/tools/api/dispatch-request';",
        errors: [{ messageId: 'deepFeatureImport' }],
      },
      {
        code: "import { uploadBody } from '@/features/files/lib/upload-body';",
        errors: [{ messageId: 'deepFeatureImport' }],
      },
      {
        code: "import { BrowserGrid } from '@/features/files/browser';",
        errors: [{ messageId: 'deepFeatureImport' }],
      },
      {
        code: "export { feed } from '@/features/notifications/api/feed';",
        errors: [{ messageId: 'deepFeatureImport' }],
      },
      {
        code: "const feed = await import('@/features/notifications/api/feed');",
        errors: [{ messageId: 'deepFeatureImport' }],
      },
    ],
  });
});
