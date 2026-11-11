'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ComposerDraft } from '../lib/composer-draft';
import { holdComposerDraft, readComposerDraft, subscribeComposerDraft } from '../lib/draft-store';

/** The draft for this key, held while the composer is on the page. */
export function useComposerDraft(draftKey: string): ComposerDraft {
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerDraft(draftKey, listener),
    [draftKey],
  );
  const read = useCallback(() => readComposerDraft(draftKey), [draftKey]);
  useEffect(() => holdComposerDraft(draftKey), [draftKey]);
  return useSyncExternalStore(subscribe, read, read);
}
