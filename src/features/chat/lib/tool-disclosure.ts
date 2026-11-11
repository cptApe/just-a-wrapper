import type { ToolChatItem } from './chat-state';
import type { ToolStatus } from './tool-display-activity';
import { isComplexInput } from './tool-display-details';

/** The slice of a tool renderer that disclosure reads; lib stays free of component imports. */
export type DisclosureRenderer = {
  disclosure?: 'none';
  hasDetails?: (item: ToolChatItem) => boolean;
  Details?: unknown;
};

export function canUnfoldToolCall({
  item,
  status,
  quiet,
  renderer,
}: {
  item: ToolChatItem;
  status: ToolStatus;
  quiet: boolean;
  renderer: DisclosureRenderer | undefined;
}): boolean {
  if (quiet || renderer?.disclosure === 'none') return false;
  if (renderer?.hasDetails) return renderer.hasDetails(item);
  return (
    isComplexInput(item.input) ||
    item.result !== undefined ||
    (status !== 'running' && renderer?.Details !== undefined)
  );
}
