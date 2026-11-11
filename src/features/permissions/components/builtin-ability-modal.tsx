'use client';

import { useState } from 'react';
import type { Icon } from '@/components/icons';
import { Modal, ModalContent, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { ModalSectionPanel, ModalSectionTabs } from '@/components/ui/modal-section-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type AbilityRow,
  type BuiltinAbilityGroupMeta,
  customToolDefaultPolicy,
} from '../constants';
import {
  DEFAULT_GENERATION_QUALITY,
  type GenerationQuality,
  QUALITY_CONFIGURABLE_TOOLS,
} from '../lib/tool-settings';
import type { ToolkitPermissions } from '../types';
import { type PolicyChange, type ToolActionRow, ToolActionsGroups } from './tool-actions';

/** A custom tool is governed by its OWN name under the `builtin` toolkit, shown
 * at its risk default when unset. Any other row is an always-on built-in. */
function toActionRow(ability: AbilityRow): ToolActionRow {
  const base = { id: ability.id, title: ability.label, access: ability.access };
  // Destructive tools with a fixed label always ask, even under Allow —
  // so it shows a fixed, non-interactive state instead of a lying switch.
  if (ability.fixedLabel) {
    return { ...base, governable: false, staticLabel: ability.fixedLabel };
  }
  if (ability.custom) {
    return {
      ...base,
      governable: true,
      toolNames: [ability.custom],
      defaultPolicy: customToolDefaultPolicy(),
    };
  }
  return { ...base, governable: false, staticLabel: 'Always on' };
}

// Built-ins share the app modal's frame, minus the connection surfaces they don't have.

const SECTIONS = [
  { value: 'overview' as const, label: 'Overview' },
  { value: 'actions' as const, label: 'Actions' },
];
type Section = (typeof SECTIONS)[number]['value'];

export function BuiltinAbilityModal({
  group,
  icon: GroupIcon,
  abilities,
  offReasons,
  permissions,
  onApply,
  onQualityChange,
  open,
  onOpenChange,
}: {
  group: BuiltinAbilityGroupMeta;
  icon: Icon;
  abilities: readonly AbilityRow[];
  offReasons: readonly string[];
  /** Null until the saved settings load; defaults would show made-up choices. */
  permissions: ToolkitPermissions | null;
  onApply: (changes: ReadonlyArray<PolicyChange>) => void;
  onQualityChange: (toolName: string, quality: GenerationQuality) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [section, setSection] = useState<Section>('overview');

  const rows: ToolActionRow[] = abilities.map((ability) => {
    const row = toActionRow(ability);
    // Only Create ability rows include a default-quality control.
    if (ability.custom && QUALITY_CONFIGURABLE_TOOLS.has(ability.custom)) {
      const toolName = ability.custom;
      return {
        ...row,
        quality: {
          value: permissions?.settings[toolName]?.defaultQuality ?? DEFAULT_GENERATION_QUALITY,
          onChange: (quality: GenerationQuality) => onQualityChange(toolName, quality),
        },
      };
    }
    return row;
  });

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setSection('overview');
        onOpenChange(next);
      }}
    >
      <ModalHeader>
        <ModalTitle reveal="scroll">{group.name}</ModalTitle>
      </ModalHeader>
      <ModalContent>
        <div className="flex min-h-0 flex-col gap-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-alpha-6 text-foreground [&_svg]:size-5"
            >
              <GroupIcon />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <h2 className="truncate text-title-section font-semibold tracking-tight">
                {group.name}
              </h2>
              <p className="truncate text-meta text-muted-foreground">Built-in ability</p>
            </div>
          </div>

          {offReasons.map((reason) => (
            <p key={reason} role="status" className="text-meta text-muted-foreground">
              {reason}
            </p>
          ))}

          {group.configurable ? (
            <ModalSectionTabs
              value={section}
              options={SECTIONS}
              onChange={setSection}
              label={`${group.name} sections`}
              idPrefix="builtin-section"
            />
          ) : null}

          <ModalSectionPanel idPrefix="builtin-section" value={section}>
            {section === 'overview' ? (
              <section aria-label={`What ${group.name} does`} className="flex flex-col gap-3">
                <p className="text-title-card leading-relaxed">{group.summary[0]}</p>
                <p className="text-title-card leading-relaxed">{group.summary[1]}</p>
                {group.configurable ? (
                  <p className="text-meta text-muted-foreground">
                    See the Actions tab to choose what your agent can do without asking you first.
                  </p>
                ) : null}
              </section>
            ) : (
              <section aria-label="Actions" className="flex flex-col gap-4">
                <p className="text-meta text-muted-foreground">
                  Choose when your agent can use these tools.
                </p>
                {permissions === null ? (
                  <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
                    <Skeleton className="h-11 rounded-md" />
                    <Skeleton className="h-11 rounded-md" />
                  </div>
                ) : (
                  <ToolActionsGroups
                    rows={rows}
                    permissions={permissions}
                    onApply={onApply}
                    disabled={false}
                  />
                )}
              </section>
            )}
          </ModalSectionPanel>
        </div>
      </ModalContent>
    </Modal>
  );
}
