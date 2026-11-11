'use client';

import { type ReactNode, useState } from 'react';
import { IconChevronRight, IconLayersThree01 } from '@/components/icons';
import { ShimmerText } from '@/components/ui/shimmer-text';
import type { ArtifactSummary } from '@/features/files/types';
import { plural } from '@/lib/format/plural';
import { cn } from '@/lib/utils';
import { groupBrowserRows } from '../lib/browser-group-model';
import type { ChatItem, ToolChatItem } from '../lib/chat-state';
import {
  type ChainStep,
  type ChainSummary,
  chainLeadLine,
  summarizeChainSteps,
} from '../lib/tool-display';
import {
  activityLine,
  aggregateActivityLine,
  describeToolActivity,
  isFailedToolCall,
  statusBadge,
  toolStatusOf,
} from '../lib/tool-display-activity';
import { lineHost } from '../lib/tool-line-host';
import type { PublicTranscriptTool } from '../types';
import { THINKING_LABEL, ThinkingBlock } from './thinking-block';
import { ToolCallBlock } from './tool-call-block';
import { ActivityLine } from './tool-renderers/activity-line';
import { BrowserGroup } from './tool-renderers/browser-group';
import { ToolLineIcon } from './tool-renderers/registry';
import { SourceFavicon } from './tool-renderers/source-favicon';

// One activity chain holds the turn’s quiet work, including work after text.
// Text stays outside; original runs keep the measured work duration accurate.
//
// Live and settled chains are both one collapsed line. While live, that line is
// the latest step and updates in place as work grows. Once settled, it becomes
// "Worked for 42 seconds" (step count only when nothing is timed). Both unfold IN PLACE: the same lines come back on
// the same left edge, as if part of the thread had been folded away.
// No indented box, no border. Activity copy comes from tool-display.ts and the
// thinking label comes from thinking-block.tsx — this file is presentation.

function AnimatedDisclosure({
  open,
  children,
  className,
  'data-testid': testId,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        'grid transition-[grid-template-rows] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      data-testid={testId}
      inert={open ? undefined : true}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            'transition-opacity duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none',
            open ? 'opacity-100' : 'opacity-0',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function toChainStep(item: ChatItem): ChainStep {
  if (item.type === 'tool') {
    return {
      kind: 'tool',
      failed: isFailedToolCall(item),
      at: item.at,
      settledAt: item.result?.at,
    };
  }
  // A chain only ever holds thinking and eligible tools (the fold guarantees it).
  return { kind: 'thought', at: item.at };
}

export function ToolChain(
  props:
    | Parameters<typeof ToolChainPresentation>[0]
    | { readOnly: true; steps: PublicTranscriptTool[] },
) {
  if ('readOnly' in props) {
    return (
      <ToolChainPresentation
        items={[]}
        active={false}
        artifactsByFileId={new Map()}
        publicSteps={props.steps}
      />
    );
  }
  return <ToolChainPresentation {...props} />;
}

function ToolChainPresentation({
  items,
  runs = [items],
  active,
  artifactsByFileId,
  sessionId,
  publicSteps,
}: {
  items: ChatItem[];
  publicSteps?: PublicTranscriptTool[];
  /** Original contiguous work runs, excluding time spent between them. */
  runs?: ChatItem[][];
  /** This chain holds the live tail of a still-working turn — its steps stack
   *  in the open, the last one possibly still running. */
  active: boolean;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  const chainRows = groupBrowserRows(items);
  const tailId = items.at(-1)?.id;
  const summary: ChainSummary = publicSteps
    ? {
        total: publicSteps.length,
        failed: publicSteps.filter((step) => step.status === 'failed').length,
        durationMs: undefined,
      }
    : summarizeChainSteps(items.map(toChainStep));
  const durationMs = publicSteps
    ? publicSteps.reduce((total, step) => total + (step.workDurationMs ?? 0), 0)
    : runs.reduce(
        (total, run) => total + (summarizeChainSteps(run.map(toChainStep)).durationMs ?? 0),
        0,
      );
  summary.durationMs = durationMs > 0 ? durationMs : undefined;

  const rows = publicSteps ? (
    <div className="flex min-w-0 flex-col gap-1">
      {publicSteps.map((step, index) => (
        <ActivityLine
          key={index}
          icon={<ToolLineIcon name={step.tool} input={{}} className="size-4" />}
          text={step.title}
          status={step.status}
          badge={statusBadge(step.status)}
          data-testid="share-tool-row"
        />
      ))}
    </div>
  ) : (
    <div className="flex min-w-0 flex-col gap-1">
      {chainRows.map((row) =>
        row.kind === 'browser-group' ? (
          <BrowserGroup
            key={row.key}
            items={row.items}
            live={active}
            artifactsByFileId={artifactsByFileId}
            sessionId={sessionId}
          />
        ) : row.kind === 'tool-run' ? (
          <GroupedToolRun
            key={row.key}
            items={row.items}
            failed={row.failed}
            live={active}
            artifactsByFileId={artifactsByFileId}
          />
        ) : (
          <ChainChild
            key={row.item.id}
            item={row.item}
            live={active}
            isTail={row.item.id === tailId}
            artifactsByFileId={artifactsByFileId}
          />
        ),
      )}
    </div>
  );

  const latest = items.at(-1);
  const latestTool = active && latest?.type === 'tool' ? latest : null;
  const latestStatus = latestTool ? toolStatusOf(latestTool) : null;
  const latestActivity = latestTool
    ? describeToolActivity(latestTool.name, latestTool.input, latestTool.result)
    : null;
  const latestHost = latestTool ? lineHost(latestTool) : null;
  const liveText =
    latestActivity && latestStatus ? activityLine(latestActivity, latestStatus) : null;
  const liveRunning = latestStatus === 'running' || (active && latest?.type === 'thinking');
  const leadText = active ? (liveText ?? THINKING_LABEL) : chainLeadLine(summary);

  return (
    <div className="flex min-w-0 flex-col" data-testid={active ? 'tool-chain-live' : 'tool-chain'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/disclosure flex min-h-11 w-fit max-w-full min-w-0 items-center gap-1 rounded-md text-left text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {active ? (
          <span aria-hidden className="mr-1 flex size-4 shrink-0 items-center justify-center">
            {latestTool ? (
              latestHost ? (
                <SourceFavicon host={latestHost} />
              ) : (
                <ToolLineIcon name={latestTool.name} input={latestTool.input} className="size-4" />
              )
            ) : (
              <IconLayersThree01 className="size-4" />
            )}
          </span>
        ) : null}
        <span className="min-w-0 break-words max-md:wrap-anywhere text-body-lg">
          <ShimmerText active={liveRunning}>{leadText}</ShimmerText>
        </span>
        <IconChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 rotate-0 opacity-0 group-hover/disclosure:opacity-100 group-focus-visible/disclosure:opacity-100 transition-[transform,opacity] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none',
            open && 'rotate-90 opacity-100',
          )}
        />
        {active ? (
          <span className="shrink-0 text-meta font-medium tabular text-foreground-tertiary">
            {plural(summary.total, 'step')}
          </span>
        ) : null}
      </button>
      <AnimatedDisclosure open={open} className="pt-1" data-testid="tool-chain-content">
        {rows}
      </AnimatedDisclosure>
    </div>
  );
}

function GroupedToolRun({
  items,
  failed,
  live,
  artifactsByFileId,
}: {
  items: ToolChatItem[];
  failed: number;
  live: boolean;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
}) {
  const [open, setOpen] = useState(false);
  const last = items.at(-1);
  if (!last) return null;
  const status = toolStatusOf(last, { live });
  const running = status === 'running';
  const representative = running
    ? last
    : (items.findLast(
        (item) =>
          describeToolActivity(item.name, item.input, item.result).groupSubject !== undefined,
      ) ?? last);
  const activity = describeToolActivity(
    representative.name,
    representative.input,
    representative.result,
  );
  const text =
    !running && failed === items.length
      ? activityLine(activity, 'failed')
      : aggregateActivityLine(activity, running ? 'running' : 'done', items.length);
  return (
    <div className="flex min-w-0 flex-col" data-testid="tool-run">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group/disclosure flex min-h-11 w-fit max-w-full items-center gap-1 rounded-md text-left text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
          <ToolLineIcon name={last.name} input={last.input} className="size-4" />
        </span>
        <span className="min-w-0 break-words max-md:wrap-anywhere text-body-lg">
          <ShimmerText active={running}>{text}</ShimmerText>
        </span>
        <IconChevronRight
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 rotate-0 opacity-0 group-hover/disclosure:opacity-100 group-focus-visible/disclosure:opacity-100 transition-[transform,opacity] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none',
            open && 'rotate-90 opacity-100',
          )}
        />
      </button>
      <AnimatedDisclosure open={open} className="pt-1" data-testid="tool-run-content">
        <div className="flex min-w-0 flex-col gap-1">
          {items.map((item) => (
            <ToolCallBlock
              key={item.id}
              item={item}
              live={live}
              artifactsByFileId={artifactsByFileId}
            />
          ))}
        </div>
      </AnimatedDisclosure>
    </div>
  );
}

function ChainChild({
  item,
  live,
  isTail,
  artifactsByFileId,
}: {
  item: ChatItem;
  live: boolean;
  isTail: boolean;
  artifactsByFileId: ReadonlyMap<string, ArtifactSummary>;
}) {
  // Thinking shows only while it is the live tail. Settled thinking renders
  // no row because the results around it say everything, but it still counts
  // in the chain's step total.
  if (item.type === 'thinking') return live && isTail ? <ThinkingBlock /> : null;
  if (item.type !== 'tool') return null;
  return <ToolCallBlock item={item} live={live} artifactsByFileId={artifactsByFileId} />;
}
