import type { ChatEvent } from '@/features/sessions';
// Runtime imports use explicit .ts relative paths for Node's type-stripping test runner.
import {
  type AttachedEntry,
  stripAttachedFiles,
} from '@/features/sessions/lib/strip-attached-files';
import type { PublicTranscriptItem } from '../types';
import { summarizeChainSteps } from './tool-display';
import { activityLine, describeToolActivity, toolStatusOf } from './tool-display-activity';
import { parseResultObject } from './tool-result-data';

// Project public transcripts server-side with explicit safe fields only.
// Drop tool arguments and results; humanize tool names using empty input.
// Strip attached_files internals, preserving names without URLs or mount paths.
// Cut from any unclosed internal opener to the end to avoid leaking truncated metadata.
const UNFINISHED_ATTACHED_FILES_BLOCK = /<attached_files>[\s\S]*$/i;

function fileName(ref: { title: string | null; blockType: 'document' | 'image' }): string {
  if (ref.title && ref.title.trim().length > 0) return ref.title;
  return ref.blockType === 'image' ? 'Image' : 'File';
}

// Only a line the parser placed with certainty yields a public name: a folder
// (`Name/ (folder) — Library folder …`, path dropped) or a file with a parsed
// URL (`Name — https://…`, URL dropped). A file entry WITHOUT a URL is a line
// that matched neither shape — the in-app chip keeps it name-only so nothing
// disappears for the owner, but here its "name" may be the raw machine line
// (an id, a path, a case-variant hint), so it is dropped.
function attachmentName(entry: AttachedEntry): string | null {
  if (entry.kind === 'folder') return entry.name.length > 0 ? entry.name : null;
  if (entry.url === null || entry.name.length === 0) return null;
  return entry.name;
}

function scrubMessageText(raw: string): { text: string; attachmentNames: string[] } {
  const { text, entries } = stripAttachedFiles(raw);
  return {
    text: text.replace(UNFINISHED_ATTACHED_FILES_BLOCK, '').trim(),
    attachmentNames: entries.map(attachmentName).filter((name): name is string => name !== null),
  };
}

export function projectPublicTranscript(
  events: ChatEvent[],
  pendingCustomToolIds: ReadonlySet<string> = new Set(),
): PublicTranscriptItem[] {
  const items: PublicTranscriptItem[] = [];
  const results = new Map(
    events.flatMap((event) =>
      event.kind === 'tool_result' ? [[event.toolUseId, event] as const] : [],
    ),
  );
  const confirmations = new Map(
    events.flatMap((event) =>
      event.kind === 'tool_confirmation' ? [[event.toolUseId, event.result] as const] : [],
    ),
  );
  let reply = 0;
  let run: Extract<ChatEvent, { kind: 'tool_use' | 'thinking' }>[] = [];
  let runTools: Extract<PublicTranscriptItem, { kind: 'tool' }>[] = [];
  const flushRun = () => {
    const summary = summarizeChainSteps(
      run.map((event) =>
        event.kind === 'thinking'
          ? { kind: 'thought', at: event.at }
          : { kind: 'tool', failed: false, at: event.at, settledAt: results.get(event.id)?.at },
      ),
    );
    if (runTools[0] && summary.durationMs !== undefined)
      runTools[0].workDurationMs = summary.durationMs;
    run = [];
    runTools = [];
  };
  for (const event of events) {
    if (event.kind === 'message') {
      const { text, attachmentNames } = scrubMessageText(event.text);
      const fileNames = [...(event.fileRefs ?? []).map(fileName), ...attachmentNames];
      if (text.length === 0 && fileNames.length === 0) continue;
      flushRun();
      if (event.role === 'user') reply += 1;
      items.push({ kind: 'message', role: event.role, text, fileNames });
    } else if (event.kind === 'thinking') {
      run.push(event);
    } else if (event.kind === 'tool_use') {
      const result = results.get(event.id);
      const confirmation = confirmations.get(event.id) ?? event.confirmation;
      const resolvedStatus = toolStatusOf(
        { name: event.name, result, confirmation },
        {
          pendingGate: event.evaluatedPermission === 'ask' && confirmation === undefined,
          live: false,
        },
      );
      const customDenied =
        event.tool === 'custom' &&
        result?.isError === true &&
        parseResultObject(result.text)?.code === 'USER_DENIED';
      const status = customDenied
        ? 'denied'
        : event.tool === 'custom' && !result && pendingCustomToolIds.has(event.id)
          ? 'gated'
          : resolvedStatus === 'running'
            ? 'interrupted'
            : resolvedStatus;
      const activity = describeToolActivity(event.name, {});
      const timing = summarizeChainSteps([
        { kind: 'tool', failed: status === 'failed', at: event.at, settledAt: result?.at },
      ]);
      const item: Extract<PublicTranscriptItem, { kind: 'tool' }> = {
        kind: 'tool',
        tool: event.name,
        title: activityLine(activity, status),
        status,
        reply,
        ...(timing.durationMs === undefined ? {} : { durationMs: timing.durationMs }),
      };
      items.push(item);
      if (status === 'gated' || status === 'denied') flushRun();
      else {
        run.push(event);
        runTools.push(item);
      }
      // File references expose names only. Result text and private URLs stay here.
      if (result?.fileRefs?.length)
        items.push({
          kind: 'message',
          role: 'assistant',
          text: '',
          fileNames: result.fileRefs.map(fileName),
        });
    }
  }
  flushRun();
  return items;
}
