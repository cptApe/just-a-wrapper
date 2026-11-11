// Fold all eligible work in a turn into one chain before its standalone content.
// Keep the original runs for timing, so text between runs adds no work time.

import type { ChatItem, ToolChatItem } from './chat-state';
import { isCreditStopResult } from './credit-stop';
import type { ToolVisibility } from './tool-display';
import { describeToolActivity, isFailedToolCall } from './tool-display-activity';

type FoldedNode =
  | { kind: 'item'; item: ChatItem }
  | { kind: 'chain'; key: string; items: ChatItem[]; runs: ChatItem[][] };

export type FoldChainOptions = {
  /** The presentation tier of a tool call (registry resolveToolVisibility). */
  visibilityOf: (item: Extract<ChatItem, { type: 'tool' }>) => ToolVisibility;
  /** True while a call is an unanswered ask-gate — it must remain standalone. */
  isPendingGate: (id: string) => boolean;
};

export type ChainRow =
  | { kind: 'item'; item: ChatItem }
  | { kind: 'tool-run'; key: string; items: ToolChatItem[]; failed: number };

function toolRunSubject(item: ToolChatItem): string | undefined {
  return describeToolActivity(item.name, item.input, item.result).groupSubject;
}

/**
 * Group maximal runs of adjacent calls with the same tool and line subject.
 * Every non-tool item flushes the run, so narration and thinking retain their
 * exact order and always separate otherwise-compatible calls.
 */
export function groupChainRows(items: ChatItem[]): ChainRow[] {
  const rows: ChainRow[] = [];
  let run: ToolChatItem[] = [];
  let runSubject: string | undefined;

  const flush = () => {
    const first = run.at(0);
    if (!first) return;
    if (run.length === 1) {
      rows.push({ kind: 'item', item: first });
    } else {
      rows.push({
        kind: 'tool-run',
        key: first.id,
        items: run,
        failed: run.filter(isFailedToolCall).length,
      });
    }
    run = [];
    runSubject = undefined;
  };

  for (const item of items) {
    if (item.type !== 'tool' || isCreditStopResult(item.result)) {
      flush();
      rows.push({ kind: 'item', item });
      continue;
    }
    const previous = run.at(-1);
    const subject = toolRunSubject(item);
    if (
      previous &&
      (previous.name !== item.name ||
        (runSubject !== undefined && subject !== undefined && runSubject !== subject))
    ) {
      flush();
    }
    run.push(item);
    runSubject ??= subject;
  }
  flush();
  return rows;
}

/** Two or more eligible items collapse into a chain. */
const CHAIN_MIN = 2;

function isChainEligible(item: ChatItem, options: FoldChainOptions): boolean {
  if (item.type === 'thinking') return true;
  if (item.type !== 'tool') return false;
  // A gate or a denial is a decision the user must see — never fold it away.
  if (options.isPendingGate(item.id)) return false;
  if (item.confirmation === 'deny') return false;
  if (isFailedToolCall(item) || isCreditStopResult(item.result)) return true;
  const visibility = options.visibilityOf(item);
  return visibility === 'hidden' || visibility === 'whisper' || visibility === 'process';
}

export function foldChainNodes(items: ChatItem[], options: FoldChainOptions): FoldedNode[] {
  const standalone: FoldedNode[] = [];
  const eligible: ChatItem[] = [];
  const runs: ChatItem[][] = [];
  let run: ChatItem[] = [];

  for (const item of items) {
    if (isChainEligible(item, options)) {
      if (run.length === 0) runs.push(run);
      run.push(item);
      eligible.push(item);
    } else {
      run = [];
      standalone.push({ kind: 'item', item });
    }
  }

  const firstEligible = eligible.at(0);
  if (
    firstEligible &&
    (eligible.length >= CHAIN_MIN ||
      eligible.some(
        (item) =>
          item.type === 'tool' && (isFailedToolCall(item) || isCreditStopResult(item.result)),
      ))
  ) {
    // Turns include the user's opening message; the chain belongs to the reply.
    const firstReplyIndex = standalone.findIndex(
      (node) => node.kind !== 'item' || node.item.type !== 'message' || node.item.role !== 'user',
    );
    const insertAt = firstReplyIndex === -1 ? standalone.length : firstReplyIndex;
    standalone.splice(insertAt, 0, { kind: 'chain', key: firstEligible.id, items: eligible, runs });
    return standalone;
  }
  // Preserve standalone singleton presentation and its original position.
  return items.flatMap((item): FoldedNode[] => {
    if (
      isChainEligible(item, options) &&
      item.type === 'tool' &&
      options.visibilityOf(item) === 'hidden'
    ) {
      return [];
    }
    return [{ kind: 'item', item }];
  });
}
