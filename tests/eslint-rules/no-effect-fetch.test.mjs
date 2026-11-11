import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import noEffectFetch from '../../eslint-rules/no-effect-fetch.mjs';

// A throwaway src tree, so the rule reads real files to tell a server-action module from others.
const root = mkdtempSync(path.join(tmpdir(), 'no-effect-fetch-'));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (file, source) => {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, source);
};
write(
  'src/features/demo/api/actions.ts',
  "// Actions.\n'use server';\nexport async function load() {}\n",
);
write('src/features/demo/lib/pure.ts', 'export function load() {}\n');
const filename = path.join(root, 'src/features/demo/hooks/use-demo.ts');

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2024, sourceType: 'module' },
});

test('no-effect-fetch', () => {
  ruleTester.run('no-effect-fetch', noEffectFetch, {
    valid: [
      // A fetch in an event handler is a mutation's job, not this rule's.
      { code: "function onClick() { fetch('/api/x'); }", filename },
      // An effect that only subscribes to the browser.
      {
        code: "useEffect(() => { window.addEventListener('focus', refresh); }, []);",
        filename,
      },
      // A helper from a module without the directive.
      {
        code: "import { load } from '../lib/pure'; useEffect(() => { load(); }, []);",
        filename,
      },
      // A type-only import from an action file brings no call.
      {
        code: "import type { load } from '../api/actions'; useEffect(() => { other(); }, []);",
        filename,
      },
      // An allowlisted stream.
      {
        code: "useEffect(() => { fetch('/api/stream'); }, []);",
        filename,
        options: [{ allow: [{ path: 'hooks/use-demo.ts', reason: 'A stream.' }] }],
      },
    ],
    invalid: [
      {
        code: "useEffect(() => { fetch('/api/x'); }, []);",
        filename,
        errors: [{ messageId: 'effectFetch', data: { name: 'fetch' } }],
      },
      {
        code: "React.useLayoutEffect(() => { void fetchJson('/api/x').then(set); }, []);",
        filename,
        errors: [{ messageId: 'effectFetch', data: { name: 'fetchJson' } }],
      },
      // A server action through a relative or an aliased import.
      {
        code: "import { load } from '../api/actions'; useEffect(() => { load(); }, []);",
        filename,
        errors: [{ messageId: 'effectFetch', data: { name: 'load' } }],
      },
      {
        code: "import { load } from '@/features/demo/api/actions'; useEffect(() => { load(); }, []);",
        filename,
        errors: [{ messageId: 'effectFetch', data: { name: 'load' } }],
      },
      // A local function that fetches, called from the effect, even through useCallback.
      {
        code: "const refresh = useCallback(async () => { await fetchJson('/api/x'); }, []); useEffect(() => { const onFocus = () => refresh(); onFocus(); }, [refresh]);",
        filename,
        errors: [
          { messageId: 'effectFetch', data: { name: 'refresh' } },
          { messageId: 'effectFetch', data: { name: 'onFocus' } },
        ],
      },
    ],
  });
});
