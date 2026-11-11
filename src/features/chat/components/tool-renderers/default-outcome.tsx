'use client';

import { CodeBlock } from '@/components/ui/code-block';
import type { ToolChatItem } from '../../lib/chat-state';
import { prettyJson } from '../../lib/pretty-json';
import { resultMessageOf } from '../../lib/tool-display-activity';
import { describeToolArgs, isComplexInput } from '../../lib/tool-display-details';
import { parseResultValue } from '../../lib/tool-result-data';

// The unfolded detail every tool gets by default: the arguments as quiet
// label/value rows, then the result as readable text (scrollable when long).
// Custom Details renderers fall back to this when a result doesn't match their
// tool's contract, so nothing ever renders silent. No borders, no cards: a
// raw result is the one thing allowed a whisper of fill, because it is the one
// thing here that is not a sentence.

export function DefaultDetails({ item }: { item: ToolChatItem }) {
  const complexInput = isComplexInput(item.input);
  const rows = complexInput ? describeToolArgs(item.name, item.input) : [];
  const flatRows = rows.length > 0 && rows.every((row) => isFlatValue(row.value));
  const hasOutput = Boolean(item.result && resultMessageOf(item.result).trim());
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {complexInput && flatRows ? <ArgRows rows={rows} /> : null}
      {complexInput && !flatRows ? (
        <CodeBlock
          code={JSON.stringify(item.input, null, 2)}
          language="json"
          label={hasOutput ? 'Input' : undefined}
        />
      ) : null}
      <DefaultOutcome item={item} label={complexInput && hasOutput ? 'Output' : undefined} />
    </div>
  );
}

function isFlatValue(value: string): boolean {
  return (
    value.length <= 160 &&
    !value.includes('\n') &&
    !value.trimStart().startsWith('{') &&
    !value.trimStart().startsWith('[')
  );
}

function ArgRows({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1.5">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="contents">
          <dt className="max-w-[10rem] truncate text-meta text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-meta">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DefaultOutcome({ item, label }: { item: ToolChatItem; label?: string }) {
  const result = item.result;
  if (!result) return null;
  const text = resultMessageOf(result);
  if (text.trim().length === 0) return null;
  if (result.isError) {
    return (
      <p
        className="whitespace-pre-wrap break-words text-meta text-destructive"
        data-testid="tool-outcome"
      >
        {text}
      </p>
    );
  }
  if (parseResultValue(text)) {
    return <CodeBlock code={prettyJson(text)} language="json" label={label} />;
  }
  return <CodeBlock code={text} label={label} />;
}
