// Note saves carry the loaded SHA so one person's edit never silently overwrites another's.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { APIError } from '@anthropic-ai/sdk';

const srcRoot = new URL('../../src/', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { shortCircuit: true, url: 'data:text/javascript,export%20{}' };
    }
    if (specifier.startsWith('@/')) {
      const relativePath = specifier.slice(2);
      const path = relativePath.endsWith('.ts') ? relativePath : `${relativePath}.ts`;
      return nextResolve(new URL(path, srcRoot).href, context);
    }
    if (
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(srcRoot.href) &&
      !specifier.endsWith('.ts')
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { AppError } = await import('../../src/lib/errors.ts');
const { createNote, updateNoteContent } = await import('../../src/features/memory/api/notes.ts');

const UPDATED_MEMORY = {
  id: 'mem_note',
  content_sha256: 'b'.repeat(64),
  content_size_bytes: 7,
  created_at: '2026-08-18T00:00:00Z',
  memory_store_id: 'memstore_test',
  memory_version_id: 'memver_new',
  path: '/note.md',
  type: 'memory',
  updated_at: '2026-08-18T00:01:00Z',
  content: 'updated',
};
const base = { type: 'content_sha256', content_sha256: 'a'.repeat(64) };
const sdkConflict = (type) =>
  APIError.generate(
    409,
    { type: 'error', error: { type, message: 'conflict' }, request_id: 'req_test' },
    undefined,
    new Headers(),
  );
const memories = (methods) => ({ beta: { memoryStores: { memories: methods } } });

test('a save sends the loaded SHA, and only an explicit restore overwrites without one', async () => {
  const sent = [];
  const client = memories({
    update: async (_id, params) => {
      sent.push(params);
      return UPDATED_MEMORY;
    },
  });
  const note = await updateNoteContent(client, 'memstore_test', 'mem_note', 'updated', base);
  assert.strictEqual(sent[0].precondition, base);
  assert.equal(note.contentSha256, UPDATED_MEMORY.content_sha256);
  await updateNoteContent(client, 'memstore_test', 'mem_note', 'restored', 'unguarded-overwrite');
  assert.equal('precondition' in sent[1], false);
});

test('a save against a note someone else changed reports an edit conflict', async () => {
  const error = sdkConflict('memory_precondition_failed_error');
  const client = memories({ update: async () => Promise.reject(error) });
  await assert.rejects(
    () => updateNoteContent(client, 'memstore_test', 'mem_note', 'updated', base),
    (thrown) =>
      thrown instanceof AppError &&
      thrown.code === 'MEMORY_EDIT_CONFLICT' &&
      thrown.cause === error,
  );
});

test('creating a note at a taken path reports a path conflict instead of overwriting', async () => {
  const client = memories({
    create: async () => Promise.reject(sdkConflict('memory_path_conflict_error')),
  });
  await assert.rejects(
    () => createNote(client, 'memstore_test', '/Untitled.md', ''),
    (thrown) => thrown instanceof AppError && thrown.code === 'MEMORY_PATH_CONFLICT',
  );
});
