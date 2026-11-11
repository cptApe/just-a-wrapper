'use client';
import { type HighlightResult } from '@streamdown/code';
import { type CSSProperties } from 'react';
import { useIsCodeFenceIncomplete } from 'streamdown';
import { useHighlightedCode } from '@/hooks/use-highlighted-code';
import { textFromNode } from '@/lib/markdown-text';
import { cn } from '@/lib/utils';
import { MarkdownCopyAction } from './markdown-copy-action';
export function MarkdownInlineCode(props: React.ComponentProps<'code'> & { node?: unknown }) {
  const inlineProps: Partial<React.ComponentProps<'code'>> & {
    node?: unknown;
  } = { ...props };
  delete inlineProps.node;
  delete inlineProps.className;
  return (
    <code
      {...inlineProps}
      data-streamdown="inline-code"
      className={cn(
        'rounded-sm bg-muted px-1.5 py-0.5 font-mono text-meta font-normal',
        props.className,
      )}
    />
  );
}

/** @public The markdown unit test calls it directly. */
export function codeBlockSource(raw: string): string {
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

type CodeTokenStyle = CSSProperties & {
  '--markdown-code-light': string;
  '--markdown-code-dark': string;
};

function codeTokenStyle(token: HighlightResult['tokens'][number][number]): CodeTokenStyle {
  const light = token.htmlStyle?.color ?? token.color ?? 'inherit';
  return {
    '--markdown-code-light': light,
    '--markdown-code-dark': token.htmlStyle?.['--shiki-dark'] ?? light,
  };
}

function HighlightedCode({ source, result }: { source: string; result: HighlightResult | null }) {
  if (!result) return <code>{source}</code>;
  return (
    <code>
      {result.tokens.map((line, lineIndex) => (
        <span className="block min-h-[1lh]" key={`${lineIndex}:${line[0]?.offset ?? 'blank'}`}>
          {line.length === 0
            ? '\u200b'
            : line.map((token) => (
                <span
                  className="markdown-code-token"
                  key={token.offset}
                  style={codeTokenStyle(token)}
                >
                  {token.content}
                </span>
              ))}
        </span>
      ))}
    </code>
  );
}

export function MarkdownCodeBlock(props: React.ComponentProps<'code'> & { node?: unknown }) {
  const incomplete = useIsCodeFenceIncomplete();
  const source = codeBlockSource(textFromNode(props.children));
  const language = props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? 'text';
  const result = useHighlightedCode(source, language, incomplete);

  return (
    <div
      data-streamdown="code-block"
      data-language={language}
      data-incomplete={incomplete || undefined}
      className="my-5 w-full min-w-0 overflow-hidden rounded-lg bg-muted"
    >
      <div className="flex min-h-11 items-center justify-between gap-3 px-3">
        <span className="truncate font-mono text-meta font-medium text-muted-foreground lowercase">
          {language}
        </span>
        <MarkdownCopyAction accessibleLabel="Copy code" text={source} disabled={incomplete} />
      </div>
      <pre
        className="m-0 max-w-full overflow-x-auto overscroll-x-contain bg-transparent px-4 pb-4 font-mono text-meta font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        tabIndex={0}
      >
        <HighlightedCode source={source} result={result} />
      </pre>
    </div>
  );
}
