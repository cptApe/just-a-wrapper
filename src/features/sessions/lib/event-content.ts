import type { BetaManagedAgentsSpanModelUsage } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { TokenUsage } from '@/features/agents';
import type { ChatErrorRetryStatus, ChatFileRef } from '../types';

// File sources trigger artifact discovery. SDK content unions differ: search-result source is a
// string, while document/image sources can hold file IDs.
export function extractFileRefs(
  content: ReadonlyArray<{ type: string }> | undefined,
): ChatFileRef[] {
  if (!content) return [];
  const refs: ChatFileRef[] = [];
  for (const block of content) {
    if (block.type !== 'document' && block.type !== 'image') continue;
    if (!('source' in block) || !isFileSource(block.source)) continue;
    refs.push({
      fileId: block.source.file_id,
      blockType: block.type,
      title:
        block.type === 'document' && 'title' in block && typeof block.title === 'string'
          ? block.title
          : null,
    });
  }
  return refs;
}

/** Narrow an unknown block source to the Files-API variant. */
function isFileSource(source: unknown): source is { type: 'file'; file_id: string } {
  if (typeof source !== 'object' || source === null) return false;
  if (!('type' in source) || source.type !== 'file') return false;
  return 'file_id' in source && typeof source.file_id === 'string';
}

export function textFromContent(content: ReadonlyArray<{ type: string }> | undefined): string {
  if (!content) return '';
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Preserve structured web-search results as ordered JSON; flattening them to text would discard
// the sources required by the renderer.
export function toolResultTextFromContent(
  content: ReadonlyArray<{ type: string }> | undefined,
): string {
  const hasSearchResults = content?.some((block) => block.type === 'search_result') ?? false;
  return hasSearchResults ? JSON.stringify(content) : textFromContent(content);
}

export function toRetryStatus(retryStatus: { type: string }): ChatErrorRetryStatus {
  switch (retryStatus.type) {
    case 'retrying':
    case 'exhausted':
    case 'terminal':
      return retryStatus.type;
    default:
      // A future SDK variant we haven't seen — treat as shown (never hide an
      // error the platform didn't promise to retry).
      return 'terminal';
  }
}

export function toTokenUsage(u: BetaManagedAgentsSpanModelUsage): TokenUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadInputTokens: u.cache_read_input_tokens,
    cacheCreationInputTokens: u.cache_creation_input_tokens,
  };
}

export function threadIdField(event: object): { threadId?: string } {
  if (!('session_thread_id' in event) || typeof event.session_thread_id !== 'string') return {};
  return { threadId: event.session_thread_id };
}
