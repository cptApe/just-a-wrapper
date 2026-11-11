// Pure search over the Built-in tab's ability-group cards. Search is the tab's
// only shaping control: there is no permission facet, so a stale ?perm= in a
// saved link cannot hide a card. Relative `.ts` paths (not the `@/` alias) so
// the Node type-stripping test runner can import this module directly.

import { isToolAvailable, toolOffMessage } from '@/features/tool-catalog/declarations';
import type { Capabilities } from '@/lib/capabilities';
import {
  ABILITY_ROWS,
  type AbilityRow,
  BUILTIN_ABILITY_GROUPS,
  type BuiltinAbilityGroupMeta,
} from '../constants';

export type BuiltinShelfCard = {
  group: BuiltinAbilityGroupMeta;
  /** The registry-backed rows the card's modal lists — the source of truth for
   *  what the card can claim. */

  abilities: AbilityRow[];
  /** Why rows in this group are off on this deployment, one sentence per setting. */
  offReasons: string[];
};

/** The raw ?q= value folded to the case-insensitive, trimmed needle every match uses. */
export function normalizeBuiltinQuery(q: string): string {
  return q.trim().toLowerCase();
}

/** A card matches when its name, blurb, or any of its ability labels contains the query. */
function matchesBuiltinShelfQuery(card: BuiltinShelfCard, query: string): boolean {
  if (query === '') return true;
  return (
    card.group.name.toLowerCase().includes(query) ||
    card.group.blurb.toLowerCase().includes(query) ||
    card.abilities.some((ability) => ability.label.toLowerCase().includes(query))
  );
}

/** Every ability-group card, in shelf order, each paired with its registry rows. */
export function builtinShelfCards(capabilities: Capabilities): BuiltinShelfCard[] {
  return BUILTIN_ABILITY_GROUPS.map((group) => {
    const rows = ABILITY_ROWS.filter((row) => row.group === group.id);
    return {
      group,
      abilities: rows.filter((row) => isRowAvailable(row, capabilities)),
      offReasons: [
        ...new Set(
          rows.flatMap((row) => {
            const reason = row.custom ? toolOffMessage(row.custom, capabilities) : null;
            return reason === null ? [] : [reason];
          }),
        ),
      ],
    };
  });
}

function isRowAvailable(row: AbilityRow, capabilities: Capabilities): boolean {
  return row.custom ? isToolAvailable(row.custom, capabilities) : true;
}

export function filterBuiltinShelfCards(
  query: string,
  cards: readonly BuiltinShelfCard[],
): BuiltinShelfCard[] {
  return cards.filter((card) => matchesBuiltinShelfQuery(card, query));
}
