'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { useCreateSession } from '@/features/sessions/api/use-create-session';
import { BillingError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
import type { SkillDetail } from '../types';

export function useEditSkillTask(skill: SkillDetail) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const createSession = useCreateSession();
  const busy = createSession.isPending || navigating;
  async function editInChat() {
    if (busy) return;
    try {
      const { sessionId } = await createSession.mutateAsync({
        tier: 'default',
        message: `I want to edit my skill "${skill.name}". Use the "Create a Skill" skill for how skills are built here. Read the current version below, ask me what should change, show me the revised draft, and save it with save_skill when I approve. Keep the same name, so it updates in place.\n\nCurrent files of "${skill.name}":\n\n${skill.files.map((file) => `--- ${file.path} ---\n${file.content}`).join('\n\n')}`,
      });
      startNavigation(() => router.push(`/app/task/${sessionId}`));
    } catch (error) {
      if (reloadWorkspaceChanged({ error: error })) return;
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'skill-edit-in-chat', skillId: skill.id });
      }
      toast.error(
        error instanceof BillingError
          ? error.message
          : 'Couldn’t start the editing task. Try again.',
      );
    }
  }

  return { busy, editInChat };
}
