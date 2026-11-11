import type { ToolResult } from './chat-state';
import { parseResultObject } from './tool-result-data';

/** Only a validated success result proves that browse_close released the paid
 * session. Transport errors and success:false keep the Live View visible. */
export function browserCloseSucceeded(result: ToolResult | undefined): boolean {
  if (!result || result.isError) return false;
  return parseResultObject(result.text)?.success === true;
}

/** Per-mount auto-open state after the newest browse_open lifecycle update. */
export function browserAutoOpenState(
  suppressed: boolean,
  result: ToolResult | undefined,
): { suppressed: boolean; shouldOpen: boolean } {
  if (result?.isError) return { suppressed: true, shouldOpen: false };
  if (result !== undefined) return { suppressed: false, shouldOpen: true };
  return { suppressed, shouldOpen: !suppressed };
}
