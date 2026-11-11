import type { BuiltinToolName } from '@/features/tool-catalog/builtin-tools';
import type { CustomToolName } from '@/features/tool-catalog/declarations';

// Every tool name the chat catalogs know, exactly as it arrives on `tool_use` events.
// Connected-app actions (GMAIL_SEND_EMAIL) are open-ended and fall back per toolkit.

/** Anthropic memory store tools. */
type MemoryToolName =
  | 'memory_list'
  | 'memory_search'
  | 'memory_read'
  | 'memory_write'
  | 'memory_edit'
  | 'memory_delete';

/** The Composio Tool Router's own meta-tools. */
type ComposioMetaToolName =
  | 'COMPOSIO_SEARCH_TOOLS'
  | 'COMPOSIO_MANAGE_CONNECTIONS'
  | 'COMPOSIO_REMOTE_WORKBENCH'
  | 'COMPOSIO_MULTI_EXECUTE_TOOL';

/** SDK toolset names outside agent_toolset_20260401 that stored transcripts can carry. */
type LegacyToolsetToolName = 'code_execution' | 'str_replace_based_edit_tool' | 'text_editor';

export type KnownToolName =
  | CustomToolName
  | BuiltinToolName
  | MemoryToolName
  | ComposioMetaToolName
  | LegacyToolsetToolName;

/** A catalog keyed by tool name, looked up by the raw name a stored event carries. */
export function toolCatalog<Entry>(
  entries: Readonly<Partial<Record<KnownToolName, Entry>>>,
): ReadonlyMap<string, Entry> {
  const known = new Map<string, Entry>();
  for (const [name, entry] of Object.entries(entries))
    if (entry !== undefined) known.set(name, entry);
  return known;
}

/** A set of tool names, checked against the known names so a typo does not compile. */
export function toolNameSet(names: readonly KnownToolName[]): ReadonlySet<string> {
  return new Set(names);
}
