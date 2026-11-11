'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { useCreateSession } from '@/features/sessions/api/use-create-session';
import { BillingError } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import { reloadWorkspaceChanged } from '@/lib/reload-workspace-changed';
export function useCreateSkillTask() {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const createSession = useCreateSession();
  const startingChat = createSession.isPending || navigating;
  async function createWithAgent() {
    if (startingChat) return;
    // The menu unmounts on select, so this toast is the only pending feedback
    // until the session exists and we navigate.
    toast.loading('Starting a task with Agent…', { id: 'skill-create-agent' });
    try {
      const { sessionId } = await createSession.mutateAsync({
        tier: 'default',
        message:
          'I want to create a new skill. Use the "Create a Skill" skill: interview me about the way of working I want to capture, draft the skill folder, show it to me, and save it with save_skill once I approve.',
      });
      toast.dismiss('skill-create-agent');
      startNavigation(() => router.push(`/app/task/${sessionId}`));
    } catch (error) {
      if (reloadWorkspaceChanged({ error: error })) return;
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'skill-create-with-agent' });
      }
      toast.error(
        error instanceof BillingError ? error.message : 'Couldn’t start the task. Try again.',
        { id: 'skill-create-agent' },
      );
    }
  }

  return { startingChat, createWithAgent };
}
