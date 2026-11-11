import 'server-only';
import { capabilities } from '@/lib/runtime-capabilities';
import type { BrowserPanelView } from '../lib/browser-panel-state';
import {
  endBrowserSession,
  readBrowserRecord,
  readRemoteSession,
  remoteIsLive,
} from './browser-lifecycle';
import { expireBrowserControl } from './browser-transitions';
import { getBrowserbaseDebugUrl } from './browserbase-client';

export type TaskBrowserView = BrowserPanelView;

// The live view reconciles ended remote browsers before offering a replay.
export async function getTaskBrowserView(
  sessionRowId: string,
  publicSessionId: string,
): Promise<TaskBrowserView> {
  const credentials = capabilities.browser;
  if (credentials.kind !== 'browserbase') return { status: 'none' };
  const record = await readBrowserRecord(sessionRowId);
  if (record.status === 'active' && record.expiredUserLease !== null)
    await expireBrowserControl(sessionRowId);
  if (record.status === null) return { status: 'none' };
  if (
    record.status === 'active' ||
    record.status === 'acting' ||
    record.status === 'user' ||
    record.status === 'closing'
  ) {
    const remote = await readRemoteSession(credentials.apiKey, record.id);
    if (remoteIsLive(remote)) {
      // A /debug failure (including a 410 from a session that stopped between
      // the two reads) propagates: the panel shows its retryable error state,
      // and the retry's status read is what decides live vs ended.
      return {
        status: 'live',
        browserbaseSessionId: record.id,
        debuggerFullscreenUrl: await getBrowserbaseDebugUrl(credentials.apiKey, record.id),
        url: record.url,
        title: record.title,
        browserStatus: record.status,
      };
    }
    await endBrowserSession(credentials, sessionRowId, record, remote);
  }
  return {
    status: 'ended',
    browserbaseSessionId: record.id,
    replayUrl: `/api/sessions/${encodeURIComponent(publicSessionId)}/replays?bb=${encodeURIComponent(record.id)}`,
    url: record.url,
    title: record.title,
  };
}
