import type React from 'react';
import { createElement } from 'react';
import {
  type Icon,
  IconCalendar,
  IconFile02,
  IconFolder,
  IconMail01,
  IconTable,
  IconUsers01,
  IconZap,
} from '@/components/icons';
import { IntegrationLogo } from '@/features/integrations/components/integration-logo';
import { ENABLED_TOOLKITS, type ToolkitSlug, toolkitLogoUrl } from '@/lib/composio/toolkits';
import { cn } from '@/lib/utils';
import type { ToolChatItem } from '../../lib/chat-state';
import { resolveDynamicVisibility, type ToolVisibility } from '../../lib/tool-display';
import { toolkitSlugOf } from '../../lib/tool-display-activity';
import { ComposioDetails } from './composio-details';
import { TOOL_RENDERERS } from './tool-renderer-catalog';
import type { ToolRendererDescriptor } from './tool-renderer-types';

/** Per-integration header glyphs for connected-app actions (Composio slugs). */
const TOOLKIT_ICONS: Partial<Record<ToolkitSlug, Icon>> = {
  gmail: IconMail01,
  outlook: IconMail01,
  googlecalendar: IconCalendar,
  googledrive: IconFolder,
  dropbox: IconFolder,
  one_drive: IconFolder,
  googledocs: IconFile02,
  notion: IconFile02,
  googlesheets: IconTable,
  hubspot: IconUsers01,
};

// A connected-app action called directly (GOOGLEDOCS_CREATE_DOCUMENT) has no
// entry of its own; it shares the batch executor's details renderer. The only
// difference is that a batched action's input block carries its action line.
const CONNECTED_APP_RENDERER: ToolRendererDescriptor = {
  description: 'A connected-app action called directly, same details as the batch executor.',
  Details: ComposioDetails,
  failedPresentation: 'details-only',
};

export function resolveToolRenderer(name: string): ToolRendererDescriptor | undefined {
  const own = TOOL_RENDERERS.get(name);
  if (own) return own;
  return toolkitSlugOf(name, {}) ? CONNECTED_APP_RENDERER : undefined;
}

/** A settled result's files render inline on the card itself when the renderer has no Preview. */
export function showsResultFilesInline(item: ToolChatItem): boolean {
  return !resolveToolRenderer(item.name)?.Preview && (item.result?.fileRefs?.length ?? 0) > 0;
}

/**
 * The presentation tier of a call: its descriptor's explicit tier first, else
 * the dynamic read/write resolution (connected-app writes → product receipt,
 * reads → process; everything else → process). The chain fold and the thread row
 * both read the SAME answer, so grouping and standalone rendering never disagree.
 */
export function resolveToolVisibility(
  name: string,
  input: Record<string, unknown>,
): ToolVisibility {
  return TOOL_RENDERERS.get(name)?.visibility ?? resolveDynamicVisibility(name, input);
}

/**
 * The header icon for a call: its own registry entry first, then its
 * integration's catalog logo, then the generic action glyph. The integration's
 * Untitled UI glyph remains visible while its catalog image loads or if loading fails.
 */
export function ToolLineIcon({
  name,
  input,
  className,
}: {
  name: string;
  input: Record<string, unknown>;
  className?: string;
}): React.JSX.Element {
  const own = TOOL_RENDERERS.get(name)?.icon;
  if (own) return createElement(own, { className });

  const toolkitSlug = toolkitSlugOf(name, input);
  const toolkit = ENABLED_TOOLKITS.find(({ slug }) => slug === toolkitSlug);
  if (toolkit) {
    const FallbackIcon = TOOLKIT_ICONS[toolkit.slug] ?? IconZap;
    return (
      <span className={cn('flex shrink-0', className)}>
        <IntegrationLogo
          logoUrl={toolkitLogoUrl(toolkit.slug)}
          slug={toolkit.slug}
          name={toolkit.name}
          size={16}
          imagePadding="p-0"
          imageRounding="rounded-sm"
          fallback={<FallbackIcon className="size-4" />}
        />
      </span>
    );
  }

  return <IconZap className={className} />;
}
