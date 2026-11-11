import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noDirectSessionRead from '../../eslint-rules/no-direct-session-read.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('no-direct-session-read', () => {
  ruleTester.run('no-direct-session-read', noDirectSessionRead, {
    valid: [
      'const caller = await resolveCaller(request.headers);',
      'const user = await resolveUser(await headers());',
      'await auth.api.signOut({ headers });',
      'const organizationId = caller.organizationId;',
    ],
    invalid: [
      {
        code: 'const session = await auth.api.getSession({ headers });',
        errors: [{ messageId: 'sessionRead' }],
      },
      {
        code: 'const read = auth.api["getSession"];',
        errors: [{ messageId: 'sessionRead' }],
      },
      {
        code: 'const organizationId = session.session.activeOrganizationId;',
        errors: [{ messageId: 'activeOrganization' }],
      },
      {
        code: 'const { activeOrganizationId } = session.session;',
        errors: [{ messageId: 'activeOrganization' }],
      },
    ],
  });
});
