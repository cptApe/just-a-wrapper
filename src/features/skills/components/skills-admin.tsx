import { AdminSection } from '@/components/admin/admin-section';
import { AdminAgentButton } from '@/components/admin/agent-button';
import {
  type Icon,
  IconArrowUpRight,
  IconBookOpen01,
  IconGraduationHat01,
  IconMagicWand02,
} from '@/components/icons';
import { Boundary } from '@/components/layouts/boundary';
import { Card } from '@/components/ui/card';
import { InlinePrompt } from '@/components/ui/inline-prompt';
import { Skeleton } from '@/components/ui/skeleton';
import { loadShippedSkills } from '../api/admin-console';
import { ANTHROPIC_DOCUMENT_SKILLS, PRESET_SKILLS } from '../constants';
import { ANTHROPIC_SKILLS_DOCS_URL } from '../lib/admin-copy';
import { skillsAdminPromptText } from '../lib/admin-prompt';
import { skillOriginTitle } from '../lib/skills-view';

const SKILL_ICONS: Readonly<Record<string, Icon>> = {
  'create-a-skill': IconMagicWand02,
  'app-guide': IconBookOpen01,
};

async function ShippedSkillsList() {
  const skills = await loadShippedSkills();

  if (skills.length === 0) {
    return <p className="text-body text-muted-foreground">No skills are included yet</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {skills.map((skill) => {
        const SkillIcon = SKILL_ICONS[skill.id] ?? IconGraduationHat01;
        return (
          <li key={skill.id}>
            <Card className="flex items-start gap-4 p-4 sm:p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-alpha-6 text-foreground">
                <SkillIcon className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-title-card">{skill.name}</h3>
                <p className="max-w-[68ch] pt-1.5 text-body text-muted-foreground">
                  {skill.customerBenefit}
                </p>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function ShippedSkillsSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-label="Loading skills">
      {PRESET_SKILLS.map((skill) => (
        <li key={skill.name} aria-hidden>
          <Card className="flex items-start gap-4 p-4 sm:p-5">
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="mt-2.5 h-4 w-full max-w-lg" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function BuiltInSkillsList() {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-title-section">{skillOriginTitle('anthropic')}</h3>
      <ul className="flex flex-col gap-3">
        {ANTHROPIC_DOCUMENT_SKILLS.map((skill) => (
          <li key={skill.skill_id}>
            <Card className="flex items-start gap-4 p-4 sm:p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-alpha-6 text-foreground">
                <IconGraduationHat01 className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-title-card">{skill.name}</h4>
                <p className="max-w-[68ch] pt-1.5 text-body text-muted-foreground">
                  {skill.description}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SkillsAdmin() {
  return (
    <AdminSection
      title="What’s included"
      action={
        <AdminAgentButton
          action="add a skill"
          op="admin.copy-skills-prompt"
          text={skillsAdminPromptText()}
        />
      }
    >
      <p className="max-w-[68ch] text-body text-muted-foreground">
        A skill gives your agent reusable instructions for a specific kind of work. Every skill in
        this bundled pack reaches each customer workspace automatically. PowerPoint, Excel, Word,
        and PDF skills from Anthropic are built in and attach to every task.{' '}
        <a
          href={ANTHROPIC_SKILLS_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-1 rounded-sm font-medium text-foreground underline decoration-alpha-24 underline-offset-4 transition-colors duration-150 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Anthropic’s guide to skills
          <span className="sr-only"> (opens in a new tab)</span>
          <IconArrowUpRight className="size-3.5 self-center" aria-hidden />
        </a>{' '}
        explains how skills work.
      </p>
      <BuiltInSkillsList />
      <Boundary
        loading={<ShippedSkillsSkeleton />}
        error={
          <InlinePrompt>
            The included skills could not be read. Check the skill folders in this checkout.
          </InlinePrompt>
        }
      >
        <ShippedSkillsList />
      </Boundary>
    </AdminSection>
  );
}
