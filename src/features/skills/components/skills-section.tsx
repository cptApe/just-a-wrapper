'use client';

import { useQueryState } from 'nuqs';
import { IconFile02, IconMagicWand01, IconSearchMd } from '@/components/icons';
import { useOrganizationId } from '@/components/providers/app-providers';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ListRow,
  ListRowContent,
  ListRowIcon,
  ListRowMeta,
  ListRowTitle,
} from '@/components/ui/list-row';
import { buildOverlayHash, openOverlay } from '@/features/overlays';
import { usePrefetchOnIntent } from '@/hooks/use-prefetch-on-intent';
import { toolsParsers } from '@/lib/tools-search-params';
import { skillQueryKeys } from '../api/keys';
import { fetchSkillDetail } from '../api/use-skill-detail';
import { useSkills } from '../api/use-skills';
import { connectionAppName } from '../lib/app-name';
import {
  filterBuiltInSkills,
  filterWorkspaceSkills,
  normalizeSkillQuery,
  type SkillOrigin,
  showWorkspaceSkillsEmptyState,
  skillListItemOrigin,
  skillOriginTitle,
} from '../lib/skills-view';
import type { SkillListItem } from '../types';

// The Skills tab shows workspace and Anthropic skills with search as its only filter.
// Workspace rows open #skill/<id>; Anthropic document skills are not openable.
// The page header hosts New.

export function SkillsSection({
  initialSkills,
  organizationId,
}: {
  initialSkills: SkillListItem[];
  organizationId: string;
}) {
  // The list is a cached query seeded by the server prop; create/delete
  // mutations edit this cache so the grid updates without a full router.refresh.
  const skills = useSkills({ organizationId, initialSkills });
  const [q] = useQueryState('q', toolsParsers.q);
  const query = normalizeSkillQuery(q);
  const builtIn = filterBuiltInSkills(query);
  const visible = filterWorkspaceSkills(skills, query);
  const included = visible.filter((item) => skillListItemOrigin(item) === 'included');
  const custom = visible.filter((item) => skillListItemOrigin(item) === 'custom');
  const showWorkspaceEmpty = showWorkspaceSkillsEmptyState({ skillCount: skills.length, query });

  // Both shelves are empty only under a search: with no query the document
  // skills always render, and an empty workspace shows its own prompt below.
  if (!showWorkspaceEmpty && visible.length === 0 && builtIn.length === 0) {
    return <EmptyState icon={IconSearchMd} title={`No skills match “${q.trim()}”`} />;
  }

  return (
    <div className="flex flex-col gap-8">
      {showWorkspaceEmpty ? (
        <EmptyState
          icon={IconMagicWand01}
          title="No skills yet"
          description="Teach your agent a way of working it brings to every task. Start with New up top"
        />
      ) : null}
      {builtIn.length > 0 || included.length > 0 ? (
        <SkillShelf origin="included">
          {included.map((skillItem) => (
            <li key={skillItem.id} className="min-w-0">
              <SkillRow skillItem={skillItem} />
            </li>
          ))}
          {builtIn.map((skill) => (
            <li key={skill.skill_id} className="min-w-0">
              <ListRow className="min-h-16 hover:bg-transparent">
                <ListRowIcon className="size-10">
                  <IconFile02 />
                </ListRowIcon>
                <ListRowContent>
                  <ListRowTitle>{skill.name}</ListRowTitle>
                  <ListRowMeta className="text-meta font-medium">{skill.description}</ListRowMeta>
                </ListRowContent>
              </ListRow>
            </li>
          ))}
        </SkillShelf>
      ) : null}

      {custom.length > 0 ? (
        <SkillShelf origin="custom">
          {custom.map((skillItem) => (
            <li key={skillItem.id} className="min-w-0">
              <SkillRow skillItem={skillItem} />
            </li>
          ))}
        </SkillShelf>
      ) : null}
    </div>
  );
}

/** One shelf — the same heading and grid geometry as an Apps group. */
function SkillShelf({ origin, children }: { origin: SkillOrigin; children: React.ReactNode }) {
  const title = skillOriginTitle(origin);
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="text-title-card font-semibold text-muted-foreground">{title}</h3>
      <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">{children}</ul>
    </section>
  );
}

function SkillRow({ skillItem }: { skillItem: SkillListItem }) {
  const organizationId = useOrganizationId();
  const { onIntent } = usePrefetchOnIntent();

  // Warm the inspector's detail query on hover/focus so the overlay opens already
  // painted (same key + queryFn as useSkillDetail — a straight cache hit).
  const prefetch = () => {
    if (organizationId === null) return;
    onIntent(skillQueryKeys.detail(organizationId, skillItem.id), ({ signal }) =>
      fetchSkillDetail(skillItem.id, signal),
    );
  };

  return (
    <ListRow asChild className="min-h-16">
      <button
        type="button"
        onClick={() => openOverlay(buildOverlayHash('skill', skillItem.id))}
        onMouseEnter={prefetch}
        onFocus={prefetch}
        aria-label={`${skillItem.name}${skillItem.isPreset ? ', included' : ''}, open skill details`}
      >
        <ListRowIcon className="size-10">
          <IconMagicWand01 />
        </ListRowIcon>
        <ListRowContent>
          <ListRowTitle>{skillItem.name}</ListRowTitle>
          <ListRowMeta className="text-meta font-medium">
            {skillItem.status === 'publishing'
              ? 'Publishing… Open to retry in chat'
              : skillItem.status === 'deleting'
                ? 'Deletion needs to finish. Open to retry.'
                : (skillItem.description ?? 'No description')}
            {skillItem.connections.length > 0
              ? ` · uses ${skillItem.connections.map(connectionAppName).join(', ')}`
              : ''}
          </ListRowMeta>
        </ListRowContent>
      </button>
    </ListRow>
  );
}
