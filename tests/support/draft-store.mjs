/** The real composer draft store, with error reporting kept local so no app environment loads. */
import * as zod from 'zod';
import * as composerDraft from '../../src/features/chat/lib/composer-draft.ts';
import { loadTsx } from './load-tsx.mjs';

export const reported = [];

export function loadDraftStore() {
  return loadTsx('src/features/chat/lib/draft-store.ts', (name) => {
    if (name === 'zod') return zod;
    if (name === './composer-draft') return composerDraft;
    if (name === '@/lib/observability-client')
      return { captureException: (error, context) => reported.push({ error, context }) };
    throw new Error(`Unexpected draft-store dependency ${name}`);
  });
}
