'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requireAnthropicClient } from '@/features/agents';
import { authorizeSessionWrite } from '@/features/sessions';
import type { ComposerSkill } from '@/features/sessions/types';
import { type AttachableSkill } from '@/features/skills';
import { listAttachableSkills } from '@/features/skills/server';
import { resolveCaller } from '@/lib/caller';
import { withRequestContext } from '@/lib/request-context';

// Server action behind the composer's "Use skills" canvas picker. It offers only skills an agent
// can load. On Home that is the set a new chat attaches; in a task it is the set that session
// was created with, read from the session's own agent snapshot, so a skill added or removed
// since then is not offered. Client code imports this FILE directly.

const SessionIdInput = z.string().uuid().optional();

export async function listComposerSkills(sessionId?: string): Promise<ComposerSkill[]> {
  return withRequestContext({ route: 'chat/composer-skills', feature: 'chat' }, async () => {
    const requested = SessionIdInput.parse(sessionId);
    const requestHeaders = await headers();
    if (requested === undefined) {
      const { workspaceId } = await resolveCaller(requestHeaders);
      return toPickerList(await listAttachableSkills({ workspaceId }));
    }
    // Only the task's creator can send into it, so only they need its skills.
    const grant = await authorizeSessionWrite({ sessionId: requested, headers: requestHeaders });
    const [skills, upstream] = await Promise.all([
      listAttachableSkills({ workspaceId: grant.workspaceId }),
      requireAnthropicClient().beta.sessions.retrieve(grant.anthropicSessionId),
    ]);
    const attached = new Set(upstream.agent.skills.map((loaded) => loaded.skill_id));
    return toPickerList(skills.filter((skill) => attached.has(skill.anthropicSkillId)));
  });
}

// Presets first, then the workspace's own skills, newest first: the order the picker has always used.
function toPickerList(skills: AttachableSkill[]): ComposerSkill[] {
  return skills
    .toSorted(
      (a, b) =>
        Number(b.kind === 'preset') - Number(a.kind === 'preset') ||
        b.updatedAt.getTime() - a.updatedAt.getTime(),
    )
    .map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
}
