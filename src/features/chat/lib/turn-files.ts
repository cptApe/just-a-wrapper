// Pure render-time collection: gather the files a single turn produced into the
// ordered set the per-turn "Files from this turn" strip renders. No React, no
// store access — it takes the turn's items plus the fact it can't derive
// (whether the tool card already shows its result files inline) and returns the
// deduped, ordered files.
//
// Sources:
//   (a) artifacts an assistant message referenced inline (message.fileIds →
//       artifactsByFileId),
//   (b) fileRefs on settled tool results in the turn.
//
// Dedupe: a file already rendered inline in the turn (a tool card's default
// ResultFiles preview) is skipped so it never repeats as a thumbnail below. Files
// are keyed by their resolved artifact id where one exists, else the Anthropic
// file id, so the same file reached through two sources collapses to one entry.

import type { ArtifactSummary } from '@/features/files/types';
import type { ChatFileRef } from '@/features/sessions';
import type { ChatItem, ToolChatItem } from './chat-state';

export type TurnFile =
  | { kind: 'artifact'; key: string; artifact: ArtifactSummary }
  | { kind: 'fileRef'; key: string; ref: ChatFileRef; artifact?: ArtifactSummary };

type CollectTurnFilesOptions = {
  /** Resolve an artifact by its Anthropic file id (session artifacts map). */
  artifactOf: (fileId: string) => ArtifactSummary | undefined;
  /** True when the tool card already shows its result fileRefs inline (the
   *  default ResultFiles preview). Mirrors tool-call-block's `showResultFiles`. */
  showsResultFilesInline: (item: ToolChatItem) => boolean;
};

type Candidate = { file: TurnFile; inline: boolean };

/** The dedupe key for a fileRef: its resolved artifact id (so it collapses with
 *  the same artifact reached via a message's fileIds) else the raw file id. */
function fileRefKey(ref: ChatFileRef, artifact: ArtifactSummary | undefined): string {
  return artifact?.id ?? ref.fileId;
}

/**
 * The files a turn produced, ordered, deduped, and stripped of anything already
 * shown inline. Empty when the turn produced no findable files (the strip then
 * renders nothing).
 */
export function collectTurnFiles(items: ChatItem[], options: CollectTurnFilesOptions): TurnFile[] {
  const candidates: Candidate[] = [];

  for (const item of items) {
    // (a) Files an assistant message referenced are surfaced only in this strip.
    if (item.type === 'message' && item.role === 'assistant' && item.fileIds) {
      for (const fileId of item.fileIds) {
        const artifact = options.artifactOf(fileId);
        if (artifact)
          candidates.push({
            file: { kind: 'artifact', key: artifact.id, artifact },
            inline: false,
          });
      }
      continue;
    }

    if (item.type !== 'tool') continue;

    // (b) Files a settled tool result referenced. Inline iff the card renders
    // them itself (default ResultFiles preview); a custom-preview tool leaves
    // them for the strip.
    const refs = item.result?.fileRefs;
    if (refs && refs.length > 0) {
      const inline = options.showsResultFilesInline(item);
      for (const ref of refs) {
        const artifact = options.artifactOf(ref.fileId);
        candidates.push({
          file: { kind: 'fileRef', key: fileRefKey(ref, artifact), ref, artifact },
          inline,
        });
      }
    }
  }

  // First pass: every key shown inline anywhere in the turn is suppressed.
  const inlineKeys = new Set<string>();
  for (const c of candidates) {
    if (c.inline) inlineKeys.add(c.file.key);
  }

  // Second pass: keep the first non-inline occurrence of each key, in order.
  const files: TurnFile[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (inlineKeys.has(c.file.key) || seen.has(c.file.key)) continue;
    seen.add(c.file.key);
    files.push(c.file);
  }
  return files;
}
