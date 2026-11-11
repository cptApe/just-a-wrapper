'use client';

import * as React from 'react';
import {
  IconCheck,
  IconChevronDown,
  IconDotsHorizontal,
  IconHand,
  IconXClose,
} from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { type StateTab, StateTabs } from '@/components/ui/state-tabs';
import { cn } from '@/lib/utils';
import { decideBuiltinToolGate, decideConnectedAppGate } from '../lib/resolve';
import { type GenerationQuality } from '../lib/tool-settings';
import type { PolicyTarget, ToolkitPermissions, ToolPolicy } from '../types';
import { QualitySelect } from './tool-quality-select';

// Group edits write each action in one batch; Mixed is derived and cannot be selected.
/** An action row is either policy-controlled, with per-tool switches, or static,
 * with a fixed label matching an always-on built-in read. */
export type ToolActionRow = {
  /** Stable id for the React key. */
  id: string;
  /** Human title shown on the row (no description — titles stand alone). */
  title: string;
  access: 'read' | 'write';
  /** A non-policy default-quality control shown alongside the permission
   * switch: the Create abilities let the user pick the default
   * generation quality. Omitted for every other row. */
  quality?: {
    value: GenerationQuality;
    onChange: (next: GenerationQuality) => void;
  };
} & (
  | {
      governable: true;
      /** The raw tool_permission names this row's policy writes/reads. */
      toolNames: readonly string[];
      /** Connected-app access read by the connected-app decider. Built-ins
       *  omit it and resolve through the built-in decider the dispatcher runs. */
      policyAccess?: 'read' | 'write';
      /** Product policy used when no explicit permission is saved. */
      defaultPolicy: ToolPolicy;
    }
  | {
      governable: false;
      /** The fixed state shown in place of a switcher, e.g. "Always on". */
      staticLabel: string;
    }
);

type GateableRow = Extract<ToolActionRow, { governable: true }>;

// Share plain glyphs between StateTabs and group menus so each policy reads consistently.
const POLICY_TABS: ReadonlyArray<StateTab<ToolPolicy>> = [
  { value: 'allow', icon: <IconCheck />, label: 'Allow' },
  { value: 'ask', icon: <IconHand />, label: 'Ask first' },
  { value: 'block', icon: <IconXClose />, label: 'Block' },
];

const POLICY_LABEL: Record<ToolPolicy, string> = {
  allow: 'Allow',
  ask: 'Ask first',
  block: 'Block',
};

const POLICY_ICON: Record<ToolPolicy, React.ReactNode> = {
  allow: <IconCheck className="size-4" />,
  ask: <IconHand className="size-4" />,
  block: <IconXClose className="size-4" />,
};

// Strictest-wins collapse when a multi-name row's covered names diverge.
const POLICY_STRICTNESS: Record<ToolPolicy, number> = { block: 3, ask: 2, allow: 1 };

// Show what the gate applies, using the same deciders as execution. Connected
// apps show a chat, where reads with no row run. Always-asking built-ins have
// fixed rows, so a governable built-in row is never `alwaysAsk`.
function rowResolved(row: GateableRow, permissions: ToolkitPermissions): ToolPolicy {
  let strictest: ToolPolicy | null = null;
  for (const name of row.toolNames) {
    const policy = shownPolicy(row, permissions.tools[name] ?? null);
    if (strictest === null || POLICY_STRICTNESS[policy] > POLICY_STRICTNESS[strictest]) {
      strictest = policy;
    }
  }
  return strictest ?? row.defaultPolicy;
}

function shownPolicy(row: GateableRow, policy: ToolPolicy | null): ToolPolicy {
  if (row.policyAccess === undefined) {
    const gate = decideBuiltinToolGate({ policy, alwaysAsk: false });
    return gate === 'run' ? 'allow' : gate === 'park' ? 'ask' : 'block';
  }
  const outcome = decideConnectedAppGate({ policy, access: row.policyAccess, sessionMode: 'auto' });
  return outcome === 'allow' ? 'allow' : outcome === 'gate' ? 'ask' : 'block';
}

type GroupState = ToolPolicy | 'mixed';

/** The derived group state: a uniform effective value
 * across the group's gateable rows shows that value; explicit divergence shows
 * Mixed. */
function deriveGroupState(rows: GateableRow[], permissions: ToolkitPermissions): GroupState | null {
  const policies = rows.map((r) => rowResolved(r, permissions));
  const first = policies.at(0);
  if (first === undefined) return null;
  return policies.every((p) => p === first) ? first : 'mixed';
}

const GROUPS: ReadonlyArray<{ access: 'read' | 'write'; title: string }> = [
  { access: 'read', title: 'Read-only tools' },
  { access: 'write', title: 'Write/delete tools' },
];

/** One optimistic permission write; applied as a batch (see `useToolkitPermissions.updateMany`). */
export type PolicyChange = { target: PolicyTarget; policy: ToolPolicy | null };

export function ToolActionsGroups({
  rows,
  permissions,
  onApply,
  disabled,
}: {
  rows: ToolActionRow[];
  permissions: ToolkitPermissions;
  onApply: (changes: ReadonlyArray<PolicyChange>) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {GROUPS.map(({ access, title }) => {
        const groupRows = rows.filter((r) => r.access === access);
        if (groupRows.length === 0) return null;
        return (
          <AccessGroup
            key={access}
            title={title}
            rows={groupRows}
            permissions={permissions}
            onApply={onApply}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}

function AccessGroup({
  title,
  rows,
  permissions,
  onApply,
  disabled,
}: {
  title: string;
  rows: ToolActionRow[];
  permissions: ToolkitPermissions;
  onApply: (changes: ReadonlyArray<PolicyChange>) => void;
  disabled: boolean;
}) {
  // Groups start expanded.
  const [open, setOpen] = React.useState(true);
  const panelId = React.useId();

  const gateableRows = rows.filter((r): r is GateableRow => r.governable);
  // A group with no gateable rows can't be set; if its static rows all show the
  // same label (e.g. every row "Always on") the header echoes it, else nothing.
  const staticLabels = rows.filter((r) => !r.governable).map((r) => r.staticLabel);
  const uniformStaticLabel =
    gateableRows.length === 0 && staticLabels.every((l) => l === staticLabels[0])
      ? staticLabels[0]
      : null;
  const groupState = gateableRows.length > 0 ? deriveGroupState(gateableRows, permissions) : null;

  const setGroup = (policy: ToolPolicy) => {
    // Apply to every gateable tool in the group as one batch of per-tool writes,
    // so the whole group reads uniformly (funnel semantics).
    const changes: PolicyChange[] = [];
    for (const row of gateableRows) {
      for (const name of row.toolNames) {
        changes.push({ target: { kind: 'tool', toolName: name }, policy });
      }
    }
    onApply(changes);
  };

  return (
    <div className="flex flex-col">
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-2 text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          )}
        >
          <IconChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[var(--ease-out)]',
              open ? 'rotate-0' : '-rotate-90',
            )}
          />
          <span className="text-title-card font-semibold">{title}</span>
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-alpha-8 px-1.5 text-meta font-medium text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        </button>
        {groupState ? (
          <GroupPolicyDropdown
            title={title}
            state={groupState}
            onPick={setGroup}
            disabled={disabled}
          />
        ) : uniformStaticLabel ? (
          <span className="text-meta font-medium text-muted-foreground">{uniformStaticLabel}</span>
        ) : null}
      </div>

      {open ? (
        <ul id={panelId} className="flex flex-col pb-1">
          {rows.map((row) => (
            <ActionRow
              key={row.id}
              row={row}
              permissions={permissions}
              onApply={onApply}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionRow({
  row,
  permissions,
  onApply,
  disabled,
}: {
  row: ToolActionRow;
  permissions: ToolkitPermissions;
  onApply: (changes: ReadonlyArray<PolicyChange>) => void;
  disabled: boolean;
}) {
  return (
    // Phone: the title wraps beside the switch on one row; only a row that
    // also carries a quality picker stacks its controls under the title.
    <li
      className={cn(
        'flex min-h-12 items-center gap-3 py-1.5 pl-6 sm:py-1',
        row.quality && 'max-sm:flex-col max-sm:items-stretch max-sm:gap-2 max-sm:py-2',
      )}
    >
      <p className="line-clamp-2 min-w-0 flex-1 text-title-card text-foreground sm:truncate">
        {row.title}
      </p>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
        {row.quality ? (
          <QualitySelect
            title={row.title}
            value={row.quality.value}
            onChange={row.quality.onChange}
            disabled={disabled}
          />
        ) : null}
        {row.governable ? (
          <StateTabs
            label={`Permission for ${row.title}`}
            value={rowResolved(row, permissions)}
            options={POLICY_TABS}
            onChange={(next) =>
              onApply(
                row.toolNames.map((name) => ({
                  target: { kind: 'tool', toolName: name },
                  policy: next,
                })),
              )
            }
            disabled={disabled}
          />
        ) : (
          <span className="text-meta font-medium text-muted-foreground">{row.staticLabel}</span>
        )}
      </div>
    </li>
  );
}

// The group dropdown selects Allow, Ask first or Block. Mixed is derived
// and appears only on the trigger. Inherited and explicit states use the same strength.
function GroupPolicyDropdown({
  title,
  state,
  onPick,
  disabled,
}: {
  title: string;
  state: GroupState;
  onPick: (policy: ToolPolicy) => void;
  disabled: boolean;
}) {
  const trigger =
    state === 'mixed'
      ? { icon: <IconDotsHorizontal className="size-4" />, label: 'Mixed' }
      : { icon: POLICY_ICON[state], label: POLICY_LABEL[state] };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Default for ${title.toLowerCase()}`}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-button border border-alpha-8 pl-2.5 pr-2 text-meta font-medium text-foreground',
            "[&_svg:not([class*='size-'])]:size-4",
            'transition-colors duration-150 ease-[var(--ease-out)]',
            'hover:bg-alpha-6',
            'data-[state=open]:bg-alpha-6',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          <span className="text-muted-foreground">{trigger.icon}</span>
          <span>{trigger.label}</span>
          <IconChevronDown className="size-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {POLICY_TABS.map((option) => (
          <DropdownMenuCheckItem
            key={option.value}
            checked={state === option.value}
            onSelect={() => onPick(option.value)}
          >
            {option.icon}
            <span>{POLICY_LABEL[option.value]}</span>
          </DropdownMenuCheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
