import { browserAutoOpenState, browserCloseSucceeded } from './browser-tool-lifecycle';
import type { ToolChatItem } from './chat-state';
export type BrowserPanelState = {
  kind: 'watching' | 'suppressed';
  handled: ReadonlySet<string>;
  command: 'none' | 'open' | 'close';
};
export function browserPanelReducer(
  state: BrowserPanelState,
  tool: ToolChatItem,
): BrowserPanelState {
  if (state.handled.has(tool.id) && !tool.result?.isError) return state;
  const handled = new Set(state.handled);
  handled.add(tool.id);
  if (tool.name === 'browse_close')
    return { ...state, handled, command: browserCloseSucceeded(tool.result) ? 'close' : 'none' };
  const next = browserAutoOpenState(state.kind === 'suppressed', tool.result);
  return {
    kind: next.suppressed ? 'suppressed' : 'watching',
    handled: next.shouldOpen ? handled : state.handled,
    command: tool.result?.isError ? 'close' : next.shouldOpen ? 'open' : 'none',
  };
}
