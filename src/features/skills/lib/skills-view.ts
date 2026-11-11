import { ANTHROPIC_DOCUMENT_SKILLS, type AnthropicDocumentSkill } from '../constants';
import type { SkillListItem } from '../types';

export type SkillOrigin = 'anthropic' | 'included' | 'custom';

export function skillOriginTitle(origin: SkillOrigin): string {
  switch (origin) {
    case 'anthropic':
    case 'included':
      return 'Included';
    case 'custom':
      return 'Created by you';
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

export function skillListItemOrigin(item: { isPreset: boolean }): SkillOrigin {
  return item.isPreset ? 'included' : 'custom';
}

/** The raw ?q= value folded to the case-insensitive, trimmed needle every match uses. */
export function normalizeSkillQuery(q: string): string {
  return q.trim().toLowerCase();
}

// Search is the only filter; source query parameters must not hide skills.
export function filterBuiltInSkills(query: string): AnthropicDocumentSkill[] {
  return ANTHROPIC_DOCUMENT_SKILLS.filter(
    (item) =>
      query === '' ||
      item.name.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query),
  );
}

export function filterWorkspaceSkills(skills: readonly SkillListItem[], query: string) {
  return skills.filter(
    (item) =>
      query === '' ||
      item.name.toLowerCase().includes(query) ||
      (item.description ?? '').toLowerCase().includes(query) ||
      item.connections.some((slug) => slug.includes(query)),
  );
}

/** The "No skills yet" prompt shows only for an empty, unsearched workspace list. */
export function showWorkspaceSkillsEmptyState(input: {
  skillCount: number;
  query: string;
}): boolean {
  return input.skillCount === 0 && input.query.trim() === '';
}
