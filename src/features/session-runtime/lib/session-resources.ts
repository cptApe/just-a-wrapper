import type Anthropic from '@anthropic-ai/sdk';
import type { BetaManagedAgentsSkillParams } from '@anthropic-ai/sdk/resources/beta/agents';
import { ANTHROPIC_DOCUMENT_SKILLS, MAX_SESSION_SKILLS } from '@/features/skills/constants';
import type { SkillSessionRef } from '@/features/skills/types';
import { AppError } from '@/lib/errors';

// Assemble the agent skill list for a session create. THIS is where the platform
// cap is enforced: an excess skill throws a typed AppError rather than
// letting the SDK reject or silently drop it.
export function buildSkillSessionResources(
  skills: SkillSessionRef[],
): BetaManagedAgentsSkillParams[] {
  const documentSkillIds = new Set<string>(
    ANTHROPIC_DOCUMENT_SKILLS.map((skill) => skill.skill_id),
  );
  const resources: BetaManagedAgentsSkillParams[] = [
    ...skills
      .filter((skill) => !documentSkillIds.has(skill.id))
      .map((skill) => ({
        type: skill.kind,
        skill_id: skill.id,
        ...(skill.version ? { version: skill.version } : {}),
      })),
    ...ANTHROPIC_DOCUMENT_SKILLS.map(({ type, skill_id }) => ({ type, skill_id })),
  ];

  if (resources.length > MAX_SESSION_SKILLS) {
    throw new AppError(
      'SKILL_LIMIT_EXCEEDED',
      'You can attach up to 496 of your own skills. 4 are built in.',
      {
        count: resources.length,
        max: MAX_SESSION_SKILLS,
      },
    );
  }

  return resources;
}

/** Build a full-replacement skill override without mutating the shared agent. */
export function buildSessionAgentWithOverrides(
  agentId: string,
  skills: BetaManagedAgentsSkillParams[],
): Anthropic.Beta.Sessions.BetaManagedAgentsAgentWithOverridesParams {
  return { type: 'agent_with_overrides', id: agentId, skills };
}
