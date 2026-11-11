'use client';

import { useQueryStates } from 'nuqs';
import * as React from 'react';
import { PageBody, PageHeader } from '@/components/layouts/page-shell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { FunnelMenu } from '@/components/ui/funnel-menu';
import { SearchField } from '@/components/ui/search-field';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { StickyToolbar } from '@/components/ui/sticky-toolbar';
// Client components imported directly — the integrations barrel is
// server-only (same precedent as page.tsx's BuiltinToolsSection import).
import { RequestAppModal } from '@/features/integrations/components/request-app-modal';
// Client component imported directly — the skills barrel carries server-only
// api/ modules (same precedent as RequestAppModal above).
import { SkillNewMenu } from '@/features/skills/components/skill-new-menu';
import { normalizeToolsParams, type ToolsTab, toolsParsers } from '@/lib/tools-search-params';
import { cn } from '@/lib/utils';

// The Tools page's client shell — the standard-page recipe (ui/toolbar.tsx):
// header row = title · search · per-tab CTA; toolbar row = fixed h-9, the
// Apps/Skills/Built-in Segmented left, the funnel right. ?tab= + ?q= + the
// Apps status facet live in the url (nuqs, replace + shallow — spec url=state).
// The three tab panels arrive as server-rendered slots and stay MOUNTED
// (hidden, not unmounted) so switching tabs never refetches.
//
// Per-tab toolbar rules live in TAB_CONFIG (one map, not three toolbars):
// search placeholder per tab; CTA only where one exists (Skills → New) — no
// reserved/hidden slot. The funnel is filter-only and Apps-only (its connected
// / not-connected facet is the one that helps); Skills and Built-in have no
// facet, so the funnel does not render on those tabs and nothing can hide an
// item there but search. Sorting belongs to list presentations, never the
// funnel. "Request an app" is a section at the very bottom of the Apps view,
// not a header action.

const TAB_OPTIONS: ReadonlyArray<SegmentedOption<ToolsTab>> = [
  { value: 'apps', label: 'Apps' },
  { value: 'skills', label: 'Skills' },
  { value: 'built-in', label: 'Built-in' },
];

// Each tab defines its search placeholder; only Skills has a header action.
// Apps places Request app below its catalog; Built-in has no primary action.
type TabCta = { kind: 'new-skill' };
const TAB_CONFIG: Record<ToolsTab, { placeholder: string; cta: TabCta | null }> = {
  apps: { placeholder: 'Search apps', cta: null },
  skills: { placeholder: 'Search skills', cta: { kind: 'new-skill' } },
  'built-in': { placeholder: 'Search built-in', cta: null },
};

export function ToolsShell({
  apps,
  skills,
  builtin,
}: {
  apps: React.ReactNode;
  skills: React.ReactNode;
  builtin: React.ReactNode;
}) {
  const [params, setParams] = useQueryStates(toolsParsers);
  const normalized = normalizeToolsParams(params);
  const { q, status, tab } = normalized;
  const [requestOpen, setRequestOpen] = React.useState(false);

  const { placeholder, cta } = TAB_CONFIG[tab];

  const panels: Array<{ value: ToolsTab; label: string; node: React.ReactNode }> = [
    { value: 'apps', label: 'Apps', node: apps },
    { value: 'skills', label: 'Skills', node: skills },
    { value: 'built-in', label: 'Built-in', node: builtin },
  ];

  const toolbar = (
    <>
      <Segmented
        label="Tools sections"
        value={tab}
        options={TAB_OPTIONS}
        onChange={(value) => {
          if (value !== null) void setParams({ tab: value, q: null, status: null });
        }}
      />
      {tab === 'apps' ? (
        <div className="flex shrink-0 items-center gap-1">
          {/* The dot marks an applied connection facet. */}
          <FunnelMenu active={status !== 'all'}>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={status}
              onValueChange={(value) => {
                const status = toolsParsers.status.parse(value);
                if (status !== null) void setParams({ status });
              }}
            >
              <DropdownMenuRadioItem value="all">All apps</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="connected">Connected</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="not-connected">Not connected</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </FunnelMenu>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title="Tools"
        className="pb-2"
        action={
          <>
            <SearchField
              value={q}
              onChange={(value) => void setParams({ q: value === '' ? null : value })}
              placeholder={placeholder}
            />
            {/* Only Skills carries a header CTA; Apps ("Request app", a
                page-bottom section) and Built-in render nothing here — the menu
                simply doesn't render where there's no CTA. "New ▾" opens the
                glass dropdown (create-with-agent / upload a .zip). */}
            {cta?.kind === 'new-skill' ? <SkillNewMenu /> : null}
          </>
        }
      />
      <StickyToolbar>{toolbar}</StickyToolbar>
      <PageBody className="flex flex-col gap-8 pt-5">
        <div className="flex flex-col gap-6">
          {panels.map((panel) => {
            // Search + the Apps facet scope to the ACTIVE tab only (spec
            // url=state: the query describes how you view THIS page, not a
            // cross-view roll-up). All three panels stay mounted (hidden, not
            // unmounted) so switching tabs never refetches; only the active one
            // is shown. No section headings — one tab, one list, one empty state.
            const visible = tab === panel.value;
            return (
              <section
                key={panel.value}
                aria-label={panel.label}
                className={cn('flex-col gap-3', visible ? 'flex' : 'hidden')}
              >
                {panel.node}
              </section>
            );
          })}
        </div>
        {/* "Request app" lives at the very bottom of the Apps view — a calm
            catalog-tail prompt, not a competing header action. */}
        {tab === 'apps' ? <RequestAppPrompt onOpen={() => setRequestOpen(true)} /> : null}
      </PageBody>

      <RequestAppModal open={requestOpen} onOpenChange={setRequestOpen} />
    </>
  );
}

/** Page-bottom button for the Apps view, the only entry to "Request an app". */
function RequestAppPrompt({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="mt-8 flex justify-center">
      <Button variant="secondary" size="sm" onClick={onOpen}>
        Request an app
      </Button>
    </div>
  );
}
