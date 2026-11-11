'use client';
import { useState } from 'react';

import { IconBrowser } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { ArtifactSummary } from '@/features/files/types';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import type { ToolChatItem } from '../../lib/chat-state';
import {
  activityLine,
  browserGroupLine,
  describeToolActivity,
  resultMessageOf,
  toolStatusOf,
} from '../../lib/tool-display-activity';
import { readBrowsedPage } from '../../lib/tool-result-data';
import { ActivityLine, LineBody } from './activity-line';
import { BrowsePageContent, BrowsePagePreview } from './browse-page-content';
import { browserInputSchema } from './browser-input-schema';

function groupHost(items: ToolChatItem[]): string | undefined {
  for (const item of items) {
    if (item.name !== 'browse_open' && item.name !== 'browse_page') continue;
    const { url } = browserInputSchema.parse(item.input);
    if (url === undefined || !URL.canParse(url)) continue;
    const host = new URL(url).host.replace(/^www\./, '');
    if (host) return host;
  }
  return undefined;
}

export function BrowserGroup({
  items,
  live,
  artifactsByFileId,
  sessionId,
}: {
  items: ToolChatItem[];
  live: boolean;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const last = items.at(-1);
  if (!last) return null;
  const statuses = items.map((item) => toolStatusOf(item, { live }));
  const running = statuses.includes('running');
  const status = running ? 'running' : 'done';
  const host = groupHost(items);
  const latestPage = items.findLast((item) => item.name === 'browse_page');
  const page =
    latestPage?.result && !latestPage.result.isError
      ? readBrowsedPage(latestPage.result.text)
      : null;
  const actions = items.flatMap((item) => {
    const error = item.result?.isError ? resultMessageOf(item.result) : null;
    const { instruction } = browserInputSchema.parse(item.input);
    if (item.name === 'browse_act' && instruction !== undefined) {
      return [{ text: instruction, error }];
    }
    if (item.name === 'browse_page') {
      const itemHost = groupHost([item]);
      return [{ text: `Opened ${itemHost ?? 'a web page'} in the browser`, error }];
    }
    return [];
  });
  const canView = items.some((item) => item.name === 'browse_open' || item.name === 'browse_act');
  const line =
    items.length === 1 && last.name === 'browse_page'
      ? activityLine(
          describeToolActivity(last.name, last.input, last.result),
          statuses[0] ?? status,
        )
      : browserGroupLine(host, running);

  return (
    <ActivityLine
      icon={<IconBrowser className="size-4" />}
      text={line}
      status={status}
      expanded={open}
      onToggle={() => setOpen((value) => !value)}
      trailing={
        canView && sessionId ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="-my-1 text-muted-foreground"
            onClick={() => openOverlay(buildOverlayHash('browser', sessionId))}
          >
            <IconBrowser aria-hidden className="size-3.5" />
            View
          </Button>
        ) : null
      }
      data-testid="browser-group"
    >
      {open ? (
        <LineBody
          className="animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          data-testid="browser-group-details"
        >
          {actions.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {actions.map((action, index) => (
                <li key={`${action.text}-${index}`} className="flex flex-col gap-0.5 text-meta">
                  <span className="text-muted-foreground">{action.text}</span>
                  {action.error ? <span className="text-destructive">{action.error}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {latestPage ? (
            <div className="flex min-w-0 flex-col gap-2">
              {page ? (
                <>
                  <BrowsePagePreview
                    item={latestPage}
                    status={toolStatusOf(latestPage, { live })}
                    artifactsByFileId={artifactsByFileId}
                  />
                  <BrowsePageContent
                    item={latestPage}
                    status={toolStatusOf(latestPage, { live })}
                    artifactsByFileId={artifactsByFileId}
                  />
                </>
              ) : latestPage.result && !latestPage.result.isError ? (
                <p className="text-meta text-muted-foreground">This page had no readable text</p>
              ) : null}
            </div>
          ) : null}
        </LineBody>
      ) : null}
    </ActivityLine>
  );
}
