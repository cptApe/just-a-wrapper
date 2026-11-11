import { after } from 'next/server';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { drainMemberCleanups } from './member-cleanup';

export function scheduleMemberCleanup(ids: string[]): void {
  const snapshot = snapshotCtx();
  after(() =>
    withRequestContext(snapshot, async () => {
      try {
        await drainMemberCleanups({ kind: 'members', ids });
      } catch (error) {
        captureException(error, { op: 'member-cleanup-background' });
      }
    }),
  );
}
