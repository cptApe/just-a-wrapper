'use client';
import { z } from 'zod';
import { parseResultObject } from '../../lib/tool-result-data';
import { browserInputSchema } from './browser-input-schema';
import { DefaultDetails } from './default-outcome';
import type { ToolRendererProps } from './tool-renderer-types';

// Unfolded detail for `browse_act`: what the agent asked the browser to do,
// in its own words, and what came back (the handler's `result` text — a
// sentence for an action, extracted text for an extraction). The page it
// ended on is already in the line ("Used the browser on example.com").
// Off-contract results fall back to the default detail.

const browserResultSchema = z.object({ result: z.string().catch('') });

export function BrowserActionDetails({ item }: ToolRendererProps) {
  const { instruction } = browserInputSchema.parse(item.input);
  const data = item.result && !item.result.isError ? parseResultObject(item.result.text) : null;
  if (item.result && !data) return <DefaultDetails item={item} />;
  const outcome = data ? browserResultSchema.parse(data).result.trim() : '';
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="browser-action">
      {instruction ? <p className="text-meta">{instruction}</p> : null}
      {outcome ? (
        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-meta leading-relaxed text-muted-foreground">
          {outcome}
        </p>
      ) : null}
    </div>
  );
}
