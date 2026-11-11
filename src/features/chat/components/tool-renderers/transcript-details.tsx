'use client';

import Link from 'next/link';
import { z } from 'zod';
import { isSafeInternalHref } from '@/lib/safe-internal-href';
import { libraryHref, libraryParentPath } from '../../lib/library-href';
import { parseResultObject } from '../../lib/tool-result-data';
import { DefaultDetails } from './default-outcome';
import { ReadingPane } from './reading-pane';
import type { ToolRendererProps } from './tool-renderer-types';

const transcriptSchema = z.object({
  text: z.string(),
  path: z.string().nullable().catch(null),
  truncated: z.unknown().transform((value) => value === true),
});

export function TranscriptDetails({ item }: ToolRendererProps) {
  if (!item.result) return null;
  if (item.result.isError) return <DefaultDetails item={item} />;
  const data = parseResultObject(item.result.text);
  const parsed = transcriptSchema.safeParse(data);
  if (!parsed.success) return <DefaultDetails item={item} />;
  const { text, path, truncated } = parsed.data;
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="transcript-details">
      <ReadingPane text={text} emptyText="The recording had no speech" />
      {truncated && path ? (
        <p className="text-meta text-muted-foreground">
          Saved the full transcript to{' '}
          {isSafeInternalHref(path) ? (
            <Link
              href={libraryHref(libraryParentPath(path))}
              className="text-foreground underline underline-offset-4 hover:text-muted-foreground"
            >
              {path}
            </Link>
          ) : (
            <span className="text-foreground">{path}</span>
          )}
        </p>
      ) : null}
    </div>
  );
}
