'use client';

import { useQueryState } from 'nuqs';
import { useState } from 'react';
import {
  type Icon,
  IconCalendar,
  IconDatabase01,
  IconFolder,
  IconGlobe01,
  IconGraduationHat01,
  IconMagicWand01,
  IconSearchMd,
} from '@/components/icons';
import { ErrorState } from '@/components/layouts/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ListRow,
  ListRowContent,
  ListRowIcon,
  ListRowMeta,
  ListRowTitle,
} from '@/components/ui/list-row';
import { toolsParsers } from '@/lib/tools-search-params';
import { BUILTIN_SHELVES, BUILTIN_TOOLKIT, type BuiltinAbilityGroupId } from '../constants';
import { useToolkitPermissions } from '../hooks/use-toolkit-permissions';
import {
  type BuiltinShelfCard,
  filterBuiltinShelfCards,
  normalizeBuiltinQuery,
} from '../lib/builtin-shelf-search';
import { BuiltinAbilityModal } from './builtin-ability-modal';

// Built-in groups open app-style Overview and Actions panels.
// Search is the only page filter; configurable groups edit permissions in
// their panel through the same allow/ask/block controls as connected apps.

const GROUP_ICONS: Record<BuiltinAbilityGroupId, Icon> = {
  web: IconGlobe01,
  files: IconFolder,
  memory: IconDatabase01,
  create: IconMagicWand01,
  skills: IconGraduationHat01,
  schedules: IconCalendar,
};

export function BuiltinToolsSection({ availableCards }: { availableCards: BuiltinShelfCard[] }) {
  const [q] = useQueryState('q', toolsParsers.q);
  const { state, updateMany, updateSettings } = useToolkitPermissions(BUILTIN_TOOLKIT);
  const [editingId, setEditingId] = useState<BuiltinAbilityGroupId | null>(null);

  const query = normalizeBuiltinQuery(q);
  const cards = filterBuiltinShelfCards(query, availableCards);

  // The modal reads the full, unfiltered card so a search never trims its rows.
  const editing =
    editingId === null
      ? null
      : (availableCards.find((card) => card.group.id === editingId) ?? null);

  // Cards sit under the BUILTIN_SHELVES headings with the same section layout
  // as the Apps and Skills tabs; a shelf with no matching card is not shown.
  return (
    <div className="flex flex-col gap-4">
      {state.kind === 'error' ? (
        <ErrorState
          title="Couldn’t load your permission settings"
          message="Reload to try again. Your saved choices are unaffected."
        />
      ) : cards.length === 0 ? (
        // Every card matches an empty query, so this state only follows a search.
        <EmptyState icon={IconSearchMd} title={`No built-in tools match “${q.trim()}”`} />
      ) : (
        <div className="flex flex-col gap-8">
          {BUILTIN_SHELVES.map((shelf) => {
            const shelfCards = cards.filter(({ group }) => group.shelf === shelf);
            if (shelfCards.length === 0) return null;
            return (
              <section key={shelf} aria-label={shelf} className="flex flex-col gap-2">
                <h3 className="text-title-card font-semibold text-muted-foreground">{shelf}</h3>
                <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">
                  {shelfCards.map(({ group, abilities, offReasons }) => {
                    const Icon = GROUP_ICONS[group.id];
                    return (
                      <li key={group.id} className="min-w-0">
                        <ListRow asChild className="min-h-16">
                          <button
                            type="button"
                            onClick={() => setEditingId(group.id)}
                            aria-label={`${group.name}. Open permissions`}
                          >
                            <ListRowIcon className="size-10">
                              <Icon />
                            </ListRowIcon>
                            <ListRowContent>
                              <ListRowTitle>{group.name}</ListRowTitle>
                              <ListRowMeta className="text-meta font-medium">
                                {abilities.length === 0 ? offReasons.join(' ') : group.blurb}
                              </ListRowMeta>
                            </ListRowContent>
                          </button>
                        </ListRow>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {editing && state.kind !== 'error' ? (
        <BuiltinAbilityModal
          group={editing.group}
          icon={GROUP_ICONS[editing.group.id]}
          abilities={editing.abilities}
          offReasons={editing.offReasons}
          permissions={state.kind === 'success' ? state.permissions : null}
          onApply={updateMany}
          onQualityChange={(toolName, quality) =>
            updateSettings(toolName, { defaultQuality: quality })
          }
          open={editingId !== null}
          onOpenChange={(open) => {
            if (!open) setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}
