import { AppError } from '@/lib/errors';
import { CHAT_DETAIL_KEY, redactSecrets } from './browser-failure-detail';

// The error content the dispatcher posts upstream when a custom-tool handler
// throws. `code` + `message` are the long-standing wire shape. AppError messages
// are application-authored, then redacted and bounded here; unknown exceptions
// get a fixed generic message, never their raw text. `detail` is opt-in: a
// handler puts a plain-words string under `context.chatDetail`, and only that
// bounded, redacted string crosses. Nothing else in the cause chain is serialized.

const MAX_TOOL_ERROR_DETAIL_CHARS = 600;
export const UNKNOWN_TOOL_ERROR_MESSAGE = 'The tool hit an internal error.';

export type ToolErrorContent = { code: string; message: string; detail?: string };

function sanitizeChatText(text: string): string {
  const clean = redactSecrets(text.replace(/\s+/g, ' ').trim());
  return clean.length > MAX_TOOL_ERROR_DETAIL_CHARS
    ? `${clean.slice(0, MAX_TOOL_ERROR_DETAIL_CHARS - 1)}…`
    : clean;
}

export function toolErrorContent(cause: unknown): ToolErrorContent {
  const code = cause instanceof AppError ? cause.code : 'TOOL_HANDLER_FAILED';
  const message =
    cause instanceof AppError ? sanitizeChatText(cause.message) : UNKNOWN_TOOL_ERROR_MESSAGE;
  const rawDetail = cause instanceof AppError ? cause.context[CHAT_DETAIL_KEY] : undefined;
  if (typeof rawDetail !== 'string') return { code, message };
  const detail = sanitizeChatText(rawDetail);
  if (!detail || detail === message) return { code, message };
  return { code, message, detail };
}
