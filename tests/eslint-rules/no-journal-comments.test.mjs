import { test } from 'node:test';
import { RuleTester } from 'eslint';
import noJournalComments from '../../eslint-rules/no-journal-comments.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

test('no-journal-comments', () => {
  ruleTester.run('no-journal-comments', noJournalComments, {
    valid: [
      '// Keep the request id stable so reconnects resume the same stream.\nresume();',
      '// Shape verified 2026-06-11 against the vendor SDK.\nrequest();',
      '// Shape verified at https://vendor.example/api on 2026-07-05.\nrequest();',
      '// Brand anchor: #163300.\npaint();',
      '// Accent is #123; alpha form #11223344.\npaint();',
      '// The proxy returns HTTP #404 for a missing fixture.\nrequest();',
      'const release = "2026-07-05";',
      '// The older client still retries.\nresume();',
      '// Rounded tiles show corner spikes in the snapshot.\npaint();',
      'const note = "the old lane spike";',
      '// A subagent lane stays live until its tools settle.\nresume();',
    ],
    invalid: [
      {
        code: '// Fixed in #12.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Keep this compatible with task #130: the older client still retries.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Reworked 2026-07-05.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Shape unverified at https://vendor.example/api on 2026-07-05.\nrequest();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Stage 13 wiring.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Measured in the proxy spike.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// The file lane owns this sweep.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
      {
        code: '// Matches the old cache behavior.\nresume();',
        errors: [{ messageId: 'journalComment' }],
      },
    ],
  });
});
