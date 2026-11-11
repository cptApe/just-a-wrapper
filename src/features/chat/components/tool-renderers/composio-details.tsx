'use client';
import { z } from 'zod';

import { CodeBlock } from '@/components/ui/code-block';
import { TOOL_ROUTER_EXECUTOR } from '@/features/permissions/lib/resolve';
import { recordOf } from '../../lib/record-of';
import { describeToolActivity, resultMessageOf } from '../../lib/tool-display-activity';
import { parseResultObject } from '../../lib/tool-result-data';
import type { ToolRendererProps } from './tool-renderer-types';

type BatchAction = {
  toolSlug: string;
  arguments: Record<string, unknown>;
};

const appErrorSchema = z.union([
  z
    .object({ response: z.object({ error: z.string() }) })
    .transform((value) => value.response.error),
  z.object({ error: z.string() }).transform((value) => value.error),
  z
    .object({ response: z.object({ data: z.object({ message: z.string() }) }) })
    .transform((value) => value.response.data.message),
]);

function errorSentence(value: Record<string, unknown>): string | null {
  const parsed = appErrorSchema.safeParse(value);
  if (!parsed.success) return null;
  return (
    parsed.data
      .split(/\n+/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? null
  );
}

const batchInputSchema = z.object({ tools: z.array(z.unknown()).catch([]) });
const batchActionSchema = z.object({
  tool_slug: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});
function batchActions(input: Record<string, unknown>): BatchAction[] {
  return batchInputSchema.parse(input).tools.flatMap((value) => {
    const action = batchActionSchema.safeParse(value);
    return action.success
      ? [{ toolSlug: action.data.tool_slug, arguments: action.data.arguments }]
      : [];
  });
}

function batchResults(item: ToolRendererProps['item']): Record<string, unknown>[] {
  if (!item.result) return [];
  const envelope = parseResultObject(item.result.text);
  const data = recordOf(envelope?.data);
  const parsed = z.array(z.unknown()).safeParse(data?.results);
  return parsed.success
    ? parsed.data.flatMap((value) => {
        const record = recordOf(value);
        return record ? [record] : [];
      })
    : [];
}

function resultErrorSentence(item: ToolRendererProps['item']): string {
  if (!item.result) return 'The action failed.';
  const envelope = parseResultObject(item.result.text);
  const plainResult = resultMessageOf(item.result).trim();
  return (envelope && errorSentence(envelope)) || plainResult || 'The action failed.';
}

function failedResult(row: Record<string, unknown> | undefined): boolean {
  return recordOf(row?.response)?.successful === false;
}

export function ComposioDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;

  if (item.name !== TOOL_ROUTER_EXECUTOR) {
    if (item.result.isError) {
      return <p className="text-meta text-destructive">{resultErrorSentence(item)}</p>;
    }
    return (
      <div className="min-w-0" data-testid="composio-details">
        <CodeBlock code={JSON.stringify(item.input, null, 2)} language="json" />
      </div>
    );
  }

  const actions = batchActions(item.input);
  const results = batchResults(item);
  if (actions.length === 0) {
    return <p className="text-meta text-muted-foreground">No app actions</p>;
  }
  if (item.result.isError && results.length === 0) {
    return <p className="text-meta text-destructive">{resultErrorSentence(item)}</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="composio-details">
      {actions.map((action, index) => {
        const result = results.find((candidate) => candidate.index === index) ?? results.at(index);
        const label = describeToolActivity(action.toolSlug, action.arguments).done;
        const error = result ? errorSentence(result) : null;
        return (
          <div key={`${action.toolSlug}-${index}`} className="flex min-w-0 flex-col gap-2">
            {actions.length > 1 ? <p className="text-meta text-muted-foreground">{label}</p> : null}
            {failedResult(result) || (actions.length === 1 && item.result?.isError) ? (
              <p className="text-meta text-destructive">{error ?? 'The action failed.'}</p>
            ) : (
              <CodeBlock code={JSON.stringify(action.arguments, null, 2)} language="json" />
            )}
          </div>
        );
      })}
    </div>
  );
}
