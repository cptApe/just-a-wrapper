'use client';

import { code as codePlugin } from '@streamdown/code';
import { Streamdown } from 'streamdown';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';
import 'streamdown/styles.css';

export type CodeBlockProps = {
  code: string;
  language?: string;
  label?: string;
  maxHeightClassName?: string;
  className?: string;
};

export const TOOL_TEXT_PREVIEW_LIMIT = 20_000;

function fencedCode(value: string, language: string): string {
  let longestRun = 0;
  for (const match of value.slice(0, TOOL_TEXT_PREVIEW_LIMIT).matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const safeLanguage = /^[A-Za-z0-9_+-]+$/.test(language) ? language : 'text';
  return `${fence}${safeLanguage}\n${value}\n${fence}`;
}

/** A compact, copyable reading surface for machine-shaped text. */
export function CodeBlock({
  code,
  language,
  label,
  maxHeightClassName = 'max-h-64',
  className,
}: CodeBlockProps) {
  const highlighted = language ? code.slice(0, TOOL_TEXT_PREVIEW_LIMIT) : code;
  const plainRemainder = language ? code.slice(TOOL_TEXT_PREVIEW_LIMIT) : '';
  const shortenedHighlight = plainRemainder.length > 0;
  const surfaceLabel = label ?? (language ? `${language} output` : 'Output');
  return (
    <div
      className={cn('min-w-0 overflow-hidden rounded-lg bg-alpha-3', className)}
      data-testid="code-block-surface"
    >
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 px-3">
        <span className="min-w-0 truncate text-meta text-muted-foreground">{surfaceLabel}</span>
        <CopyButton
          text={code}
          label="Copy"
          accessibleLabel={`Copy ${surfaceLabel.toLowerCase()}`}
          op="chat.copy-tool-code"
          variant="ghost"
          size="sm"
          className="-mr-2 min-h-11 shrink-0 text-muted-foreground"
        />
      </div>
      {shortenedHighlight ? (
        <p className="px-3 pb-1 text-meta text-muted-foreground">Showing the first part</p>
      ) : null}
      <div
        className={cn(
          'overflow-auto px-3 pb-3 font-mono text-meta font-normal leading-relaxed text-muted-foreground',
          maxHeightClassName,
          language
            ? 'whitespace-pre [overflow-wrap:normal] [&_[data-streamdown=code-block]]:!m-0 [&_[data-streamdown=code-block]]:!min-w-max [&_[data-streamdown=code-block]]:!gap-0 [&_[data-streamdown=code-block]]:!rounded-none [&_[data-streamdown=code-block]]:!border-0 [&_[data-streamdown=code-block]]:!bg-transparent [&_[data-streamdown=code-block]]:!p-0 [&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-body]]:!min-w-max [&_[data-streamdown=code-block-body]]:!rounded-none [&_[data-streamdown=code-block-body]]:!border-0 [&_[data-streamdown=code-block-body]]:!bg-transparent [&_[data-streamdown=code-block-body]]:!p-0 [&_[data-streamdown=code-block-body]]:!text-meta [&_[data-streamdown=code-block-body]]:!font-normal [&_pre]:!m-0 [&_pre]:!min-w-max [&_pre]:!whitespace-pre [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!whitespace-pre [&_code]:[overflow-wrap:normal] [&_code>span]:block'
            : 'whitespace-pre [overflow-wrap:normal]',
        )}
        data-testid="code-block"
      >
        {language ? (
          <>
            <Streamdown
              plugins={{ code: codePlugin }}
              controls={false}
              lineNumbers={false}
              mode="static"
              animated={false}
            >
              {fencedCode(highlighted, language)}
            </Streamdown>
            {plainRemainder ? (
              <pre
                className="m-0 min-w-max whitespace-pre bg-transparent p-0 font-mono [overflow-wrap:normal]"
                data-testid="code-block-plain-remainder"
              >
                {plainRemainder}
              </pre>
            ) : null}
          </>
        ) : (
          <pre className="min-w-max whitespace-pre font-mono [overflow-wrap:normal]">{code}</pre>
        )}
      </div>
    </div>
  );
}
