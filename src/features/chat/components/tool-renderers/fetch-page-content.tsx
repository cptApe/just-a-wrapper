'use client';
import { z } from 'zod';

import { fetchFailureText } from '../../lib/tool-display-activity';
import { fetchedPageSources, readFetchedPages } from '../../lib/tool-result-data';
import { hostLabel } from '../../lib/url-display';
import { DefaultDetails } from './default-outcome';
import { SourceChips } from './source-chips';
import { SourceFavicon } from './source-favicon';
import type { ToolRendererProps } from './tool-renderer-types';

// Unfolded detail for `fetch_page` (Exa /contents): multiple input pages reduce
// to source chips only. A single page keeps the richer linked title + summary
// row, with an unreadable URL listed plainly in non-technical wording. Errors
// and off-contract results fall back to the default detail so nothing is silent.

const urlsSchema = z
  .array(z.string().nullable().catch(null))
  .catch([])
  .transform((urls) => urls.filter((url) => url !== null));

export function FetchPageContent({ item }: ToolRendererProps) {
  if (!item.result) return null;
  const data = item.result.isError ? null : readFetchedPages(item.result.text);
  if (!data) return <DefaultDetails item={item} />;

  const inputUrls = urlsSchema.parse(item.input.urls);
  const sources = fetchedPageSources(inputUrls, data);
  if (sources) return <SourceChips sources={sources} />;

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-testid="fetched-pages">
      {data.pages.length === 0 && data.failed.length === 0 ? (
        <p className="text-meta text-muted-foreground">No pages were read</p>
      ) : null}
      {data.pages.length > 0 ? (
        <ul className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
          {data.pages.map((page, index) => {
            const line = page.summary ?? page.firstHighlight;
            const host = hostLabel(page.url);
            return (
              <li key={`${index}-${page.url}`} className="min-w-0 max-w-full">
                <a
                  href={page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors duration-150 [@media(hover:hover)]:hover:bg-alpha-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <SourceFavicon host={host} className="size-3.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-meta font-medium text-foreground underline-offset-2 [@media(hover:hover)]:group-hover:underline">
                      {page.title}
                    </span>
                    {line ? (
                      <span className="line-clamp-1 text-meta text-muted-foreground">{line}</span>
                    ) : null}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}

      {data.failed.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="fetched-pages-failed">
          {data.failed.map((failure, index) => (
            <li
              key={`${index}-${failure.url}`}
              className="min-w-0 break-words text-meta text-muted-foreground"
            >
              {fetchFailureText(hostLabel(failure.url), failure.reason)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
