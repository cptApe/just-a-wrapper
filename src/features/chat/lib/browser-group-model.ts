import type { ChatItem, ToolChatItem } from './chat-state';
import { type ChainRow, groupChainRows } from './fold-chain';
import { toolNameSet } from './tool-names';

const BROWSER_TOOL_NAMES = toolNameSet([
  'browse_open',
  'browse_page',
  'browse_act',
  'browse_close',
]);

type BrowserChainRow = ChainRow | { kind: 'browser-group'; key: string; items: ToolChatItem[] };

function isBrowserTool(item: ChatItem): item is ToolChatItem {
  return item.type === 'tool' && BROWSER_TOOL_NAMES.has(item.name);
}

/** Fold each maximal adjacent browser run without disturbing other chain runs. */
export function groupBrowserRows(items: ChatItem[]): BrowserChainRow[] {
  const rows: BrowserChainRow[] = [];
  let browserRun: ToolChatItem[] = [];
  let otherRun: ChatItem[] = [];

  const flushBrowser = () => {
    const first = browserRun.at(0);
    if (first) {
      rows.push({ kind: 'browser-group', key: first.id, items: browserRun });
      browserRun = [];
    }
  };
  const flushOther = () => {
    if (otherRun.length > 0) {
      rows.push(...groupChainRows(otherRun));
      otherRun = [];
    }
  };

  for (const item of items) {
    if (isBrowserTool(item)) {
      flushOther();
      browserRun.push(item);
    } else {
      flushBrowser();
      otherRun.push(item);
    }
  }
  flushBrowser();
  flushOther();
  return rows;
}
