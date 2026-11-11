'use client';
import { z } from 'zod';
import { CodeBlock } from '@/components/ui/code-block';
import { lenientOptional } from '../../lib/lenient-optional';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

const builtinInputSchema = z
  .object({
    command: z.unknown().optional(),
    content: z.unknown().optional(),
    file_path: z.unknown().optional(),
    path: z.unknown().optional(),
    old_str: z.unknown().optional(),
    old_string: z.unknown().optional(),
    new_str: z.unknown().optional(),
    new_string: z.unknown().optional(),
  })
  .transform((input) => ({
    command: input.command,
    content: input.content,
    // The two built-in edit dialects use different field names.
    path: input.file_path ?? input.path,
    before: input.old_str ?? input.old_string,
    after: input.new_str ?? input.new_string,
  }))
  .pipe(
    z.object({
      command: lenientOptional(z.string()),
      content: lenientOptional(z.string()),
      path: lenientOptional(z.string()),
      before: lenientOptional(z.string()),
      after: lenientOptional(z.string()),
    }),
  );

function languageOf(path: string | undefined): string {
  const extension = path?.split('.').at(-1)?.toLowerCase();
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    md: 'markdown',
    mjs: 'javascript',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'tsx',
    yml: 'yaml',
  };
  if (!extension) return 'text';
  return aliases[extension] ?? extension;
}

export function BashDetails({ item, status }: ToolRendererProps) {
  if (status === 'failed') return <DefaultDetails item={item} />;
  const { command } = builtinInputSchema.parse(item.input);
  const output = item.result?.text.trim() ?? '';
  if (!command && !output) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="bash-details">
      {command ? (
        <CodeBlock code={command} language="bash" label={output ? 'Command' : undefined} />
      ) : null}
      {output ? <CodeBlock code={output} label={command ? 'Output' : undefined} /> : null}
    </div>
  );
}

export function hasBashDetails(item: ToolRendererProps['item']): boolean {
  return (
    item.result?.isError === true ||
    builtinInputSchema.parse(item.input).command !== undefined ||
    Boolean(item.result?.text.trim())
  );
}

export function ReadDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  if (item.result.isError) return <DefaultDetails item={item} />;
  return (
    <CodeBlock
      code={item.result.text}
      language={languageOf(builtinInputSchema.parse(item.input).path)}
    />
  );
}

export function hasReadDetails(item: ToolRendererProps['item']): boolean {
  return Boolean(item.result?.text.trim());
}

export function WriteDetails({ item }: ToolRendererProps) {
  if (item.result?.isError) return <DefaultDetails item={item} />;
  const { content, path } = builtinInputSchema.parse(item.input);
  if (!content) return null;
  return <CodeBlock code={content} language={languageOf(path)} label={path} />;
}

export function hasWriteDetails(item: ToolRendererProps['item']): boolean {
  return (
    item.result?.isError === true || builtinInputSchema.parse(item.input).content !== undefined
  );
}

export function EditDetails({ item }: ToolRendererProps) {
  if (item.result?.isError) return <DefaultDetails item={item} />;
  const { before, after, path } = builtinInputSchema.parse(item.input);
  if (before === undefined && after === undefined) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="edit-details">
      {before !== undefined ? (
        <CodeBlock code={before} language={languageOf(path)} label="Before" />
      ) : null}
      {after !== undefined ? (
        <CodeBlock code={after} language={languageOf(path)} label="After" />
      ) : null}
    </div>
  );
}

export function hasEditDetails(item: ToolRendererProps['item']): boolean {
  const { before, after } = builtinInputSchema.parse(item.input);
  return item.result?.isError === true || before !== undefined || after !== undefined;
}
