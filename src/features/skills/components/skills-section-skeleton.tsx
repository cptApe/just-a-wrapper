import { ListRow, ListRowContent, ListRowIcon } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { ANTHROPIC_DOCUMENT_SKILLS, PRESET_SKILLS } from '../constants';
import { skillOriginTitle } from '../lib/skills-view';

const WORKSPACE_PLACEHOLDER_ROWS = [0, 1, 2];

// Included names are static config, so skeleton widths use them; custom rows are not known yet.
export function SkillsSectionSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading skills">
      <section aria-hidden className="flex flex-col gap-2">
        <h3 className="text-title-card font-semibold text-muted-foreground">
          {skillOriginTitle('included')}
        </h3>
        <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">
          {PRESET_SKILLS.map((skill) => (
            <li key={skill.name} className="min-w-0">
              <SkeletonRow titleWidth={`${skill.name.length}ch`} />
            </li>
          ))}
          {ANTHROPIC_DOCUMENT_SKILLS.map((skill) => (
            <li key={skill.skill_id} className="min-w-0">
              <SkeletonRow titleWidth={`${skill.name.length}ch`} />
            </li>
          ))}
        </ul>
      </section>
      <section aria-hidden className="flex flex-col gap-2">
        <h3 className="text-title-card font-semibold text-muted-foreground">
          {skillOriginTitle('custom')}
        </h3>
        <ul className="grid gap-y-1 sm:grid-cols-2 sm:gap-x-6">
          {WORKSPACE_PLACEHOLDER_ROWS.map((i) => (
            <li key={i} className="min-w-0">
              <SkeletonRow titleWidth="8rem" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SkeletonRow({ titleWidth }: { titleWidth: string }) {
  return (
    <ListRow className="min-h-16 hover:bg-transparent">
      <ListRowIcon className="size-10">
        <Skeleton className="size-4 rounded-sm" />
      </ListRowIcon>
      <ListRowContent>
        <Skeleton className="h-4 max-w-full" style={{ width: titleWidth }} />
        <Skeleton className="h-3 w-4/5 max-w-[280px]" />
      </ListRowContent>
    </ListRow>
  );
}
