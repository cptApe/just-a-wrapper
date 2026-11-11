'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { detectTimeZone, isValidTimeZone } from '../lib/time-preferences';
import { type TimezoneSyncState, timezoneSyncReducer } from '../lib/timezone-sync-machine';

const STORAGE_PREFIX = 'just-a-wrapper:browser-timezone-synced:';
const syncStates = new Map<string, TimezoneSyncState>();

/** Sends the browser timezone at most once per tab session for this user. */
export function BrowserTimeZoneSync({
  userId,
  browserTimeZone,
}: {
  userId: string | null;
  browserTimeZone: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;

    const detectedTimeZone = detectTimeZone();
    if (!isValidTimeZone(detectedTimeZone) || detectedTimeZone === browserTimeZone) return;

    // Without a tab marker, skip automatic sync to avoid repeated background writes.
    const storageKey = `${STORAGE_PREFIX}${userId}`;
    try {
      if (sessionStorage.getItem(storageKey) === '1') return;
    } catch (cause) {
      captureException(cause, { feature: 'browser-timezone', op: 'session-storage' });
      return;
    }

    const current = syncStates.get(storageKey) ?? { kind: 'idle' };
    if (current.kind !== 'idle') return;
    const attempt = Symbol();
    syncStates.set(storageKey, timezoneSyncReducer(current, { type: 'start', attempt }));
    void fetchVoid('/api/preferences/timezone', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone: detectedTimeZone }),
    })
      .then(() => {
        const saving = syncStates.get(storageKey);
        if (saving === undefined) return;
        syncStates.set(storageKey, timezoneSyncReducer(saving, { type: 'saved', attempt }));
        sessionStorage.setItem(storageKey, '1');
        router.refresh();
      })
      .catch((cause: unknown) => {
        const saving = syncStates.get(storageKey);
        if (saving !== undefined)
          syncStates.set(storageKey, timezoneSyncReducer(saving, { type: 'failed', attempt }));
        // A failed sync clears its marker so a later mount can retry.
        try {
          sessionStorage.removeItem(storageKey);
        } catch (storageCause) {
          captureException(storageCause, { feature: 'browser-timezone', op: 'session-storage' });
        }
        captureException(cause, { feature: 'browser-timezone', op: 'save' });
      });
  }, [browserTimeZone, router, userId]);

  return null;
}
