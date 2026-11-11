'use client';

import { useState } from 'react';
import type { ArtifactSummary } from '@/features/files/types';
import type { ToolChatItem } from '../lib/chat-state';
import { canUnfoldToolCall } from '../lib/tool-disclosure';
import {
  activityLine,
  describeToolActivity,
  statusBadge,
  toolStatusOf,
} from '../lib/tool-display-activity';
import { isFramelessRender } from '../lib/tool-display-details';
import { lineHost } from '../lib/tool-line-host';
import { useToolDecisionsView, useToolGate } from './tool-decisions-context';
import { ActivityLine, LineBody } from './tool-renderers/activity-line';
import { DefaultDetails } from './tool-renderers/default-outcome';
import {
  resolveToolRenderer,
  resolveToolVisibility,
  showsResultFilesInline,
  ToolLineIcon,
} from './tool-renderers/registry';
import { ResultFiles } from './tool-renderers/result-files';
import { SourceFavicon } from './tool-renderers/source-favicon';
import { ToolApproval } from './tool-renderers/tool-approval';

// One tool call, as the thread shows it: a quiet activity line in the same
// type as the reply, with the state in its words ("Searching the web" →
// "Searched 5 websites"; "Couldn't read lrt.lt · Failed"). No card, no
// border, no status column. What hangs under the line, on the same left edge:
// a rich preview when the tool produced something to look at (a page snapshot,
// the files it made, the answer it was given), the approval card or its
// resolved receipt, and the unfolded details when the user asks for them.
// Whisper and hidden tools are the line alone — never a result, never an
// unfold. Its decision state comes from the task's tool decisions (useToolGate).

export function ToolCallBlock({
  item,
  artifactsByFileId,
  live = true,
}: {
  item: ToolChatItem;
  /** Session artifacts keyed by Anthropic file id — rich results render inline. */
  artifactsByFileId?: ReadonlyMap<string, ArtifactSummary>;
  /** Whether the turn holding this call is still working. A resultless call in
   *  a settled turn was interrupted, and reads so. */
  live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const gate = useToolGate(item.id);
  const { canDecide } = useToolDecisionsView();
  const status = toolStatusOf(item, { pendingGate: gate.kind !== 'none', live });
  const visibility = resolveToolVisibility(item.name, item.input);
  const activity = describeToolActivity(item.name, item.input, item.result);
  const approvalAction = activityLine(activity, 'gated');
  const approvalDecision =
    item.evaluatedPermission === 'ask' &&
    (item.confirmation === 'allow' || item.confirmation === 'deny')
      ? item.confirmation
      : undefined;
  const renderer = resolveToolRenderer(item.name);
  const Preview = renderer?.Preview;
  const Details = renderer?.Details;
  const rendererProps = { item, status, artifactsByFileId };
  const approvalSurface =
    status === 'gated' || approvalDecision ? (
      <ToolApproval
        action={approvalAction}
        consequence={renderer?.consequence}
        decision={approvalDecision}
        gate={gate}
        viewerDecides={canDecide}
      />
    ) : null;

  // Frameless tools (generate_image / generate_video): once settled and
  // readable, the artifact IS the message — no line above it.
  if (
    Preview &&
    isFramelessRender(status, {
      frameless: renderer.frameless === true,
      canRenderSettled: renderer.canRenderFrameless?.(item) ?? true,
    })
  ) {
    return (
      <div data-testid="tool-frameless">
        <Preview {...rendererProps} />
        {approvalDecision ? <div className="pt-1.5">{approvalSurface}</div> : null}
      </div>
    );
  }

  // Connected-app providers already return a user-facing failure sentence.
  // Show that sentence directly instead of hiding it behind another failed row.
  if (status === 'failed' && renderer?.failedPresentation === 'details-only' && Details) {
    return (
      <div className="min-w-0" data-testid="tool-activity">
        <Details {...rendererProps} />
        {approvalDecision ? <div className="pt-1.5">{approvalSurface}</div> : null}
      </div>
    );
  }

  // Whisper and hidden tools are the line alone: no result, no unfold. A gate
  // or a denial on one still shows its decision.
  const quiet = (visibility === 'whisper' || visibility === 'hidden') && status !== 'gated';
  const canUnfold = canUnfoldToolCall({ item, status, quiet, renderer });
  // Rich outputs every tool gets for free: files a settled result referenced.
  const showResultFiles = showsResultFilesInline(item);
  const host = lineHost(item);
  const icon = host ? (
    <SourceFavicon host={host} />
  ) : (
    <ToolLineIcon name={item.name} input={item.input} className="size-4" />
  );

  return (
    <ActivityLine
      icon={icon}
      text={activityLine(activity, status)}
      status={status}
      badge={statusBadge(status)}
      expanded={open}
      onToggle={canUnfold ? () => setOpen((v) => !v) : undefined}
      className="min-w-0"
      data-testid="tool-activity"
    >
      {approvalSurface ? <LineBody>{approvalSurface}</LineBody> : null}
      {Preview ? (
        <LineBody>
          <Preview {...rendererProps} />
        </LineBody>
      ) : null}
      {showResultFiles && item.result ? (
        <LineBody>
          <ResultFiles result={item.result} artifactsByFileId={artifactsByFileId} />
        </LineBody>
      ) : null}
      {open && canUnfold ? (
        // A soft fade-in on reveal, disabled under reduced-motion.
        <LineBody
          className="animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          data-testid="tool-details"
        >
          {Details ? <Details {...rendererProps} /> : <DefaultDetails item={item} />}
        </LineBody>
      ) : null}
    </ActivityLine>
  );
}
