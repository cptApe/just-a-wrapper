import type { ToolChatItem } from './chat-state';
import { toolNameSet } from './tool-names';
import { firstSearchResultHost } from './tool-result-data';
import { hostLabel } from './url-display';

const WEB_LINE_TOOLS = toolNameSet(['web_fetch', 'browse_page', 'browse_open', 'fetch_page']);

/** The website a line is about, from the first direct-page input or the first
 * settled search result. Direct page tools prefer `url`, then the first valid
 * entry in `urls`; the favicon therefore remains stable for multi-page reads. */
export function lineHost(item: ToolChatItem): string | undefined {
  if (WEB_LINE_TOOLS.has(item.name)) {
    const directUrl = item.input.url;
    const urls = item.input.urls;
    const url =
      typeof directUrl === 'string'
        ? directUrl
        : Array.isArray(urls) && typeof urls[0] === 'string'
          ? urls[0]
          : undefined;
    return url ? hostLabel(url) : undefined;
  }
  return firstSearchResultHost(item.name, item.result);
}
