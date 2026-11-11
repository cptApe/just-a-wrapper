'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppError } from '@/lib/errors';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { chatQueryKeys } from '../api/keys';
import { getSessionShare, setSessionShareChoice } from '../api/shares';
import { getSessionTeamVisibility } from '../api/team-share';

type ShareChoice = 'public' | 'team' | 'private';

export function activeShareChoice(isPublic: boolean, sharedWithTeam: boolean) {
  return isPublic ? 'public' : sharedWithTeam ? 'team' : 'private';
}

export function useSessionShare(sessionId: string) {
  const queryClient = useQueryClient();
  const queryKey = chatQueryKeys.sharing(sessionId);
  const query = useQuery({
    queryKey,
    staleTime: 0,
    queryFn: async () => {
      const [share, team] = await Promise.all([
        getSessionShare(sessionId),
        getSessionTeamVisibility(sessionId),
      ]);
      if (!share.ok) throw new AppError('API_REQUEST_FAILED', share.message);
      if (!team.ok) throw new AppError('API_REQUEST_FAILED', team.message);
      return { share: share.data, visibility: team.data.visibility };
    },
  });
  const mutation = useMutation({
    mutationFn: async (choice: ShareChoice) => {
      const response = await setSessionShareChoice(sessionId, choice);
      if (!response.ok) throw new AppError('API_REQUEST_FAILED', response.message);
      return response.data;
    },
    ...optimisticMutation(queryClient, {
      root: queryKey,
      // Only the server can mint a public link, so that choice waits for its answer.
      apply: (choice: ShareChoice) => {
        if (choice !== 'public') {
          queryClient.setQueryData<{ share: unknown; visibility: 'private' | 'workspace' }>(
            queryKey,
            (old) =>
              old && {
                ...old,
                share: null,
                visibility: choice === 'team' ? 'workspace' : 'private',
              },
          );
        }
      },
      failure: () => ({
        message: 'Could not update sharing',
        capture: { op: 'update-task-sharing', sessionId },
      }),
      // The response below carries the saved sharing state.
      settle: () => undefined,
    }),
    onSuccess: (sharing) => {
      queryClient.setQueryData(queryKey, sharing);
    },
  });
  const setChoice = (choice: ShareChoice) => {
    if (mutation.isPending) return;
    mutation.mutate(choice);
  };
  return {
    query,
    pending: mutation.isPending,
    publicUrl: query.data?.share?.url ?? null,
    setChoice,
  };
}
