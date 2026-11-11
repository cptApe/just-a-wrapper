'use client';

import {
  type InfiniteData,
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { fetchVoid } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { scheduleSessionListInvalidate } from './invalidate';
import { sessionQueryKeys } from './keys';
import { patchRow } from './session-list-cache';
import { beginDelete, beginField, type RollbackContext } from './session-list-edits';
import type { SessionsPage } from './use-session-list';

type InfiniteSessions = InfiniteData<SessionsPage, string | null>;

async function patchSession(
  sessionId: string,
  body: { title?: string; favorited?: boolean },
): Promise<void> {
  await fetchVoid(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

async function deleteSession(sessionId: string, onDeleted: OnSessionDeleted): Promise<void> {
  await fetchVoid(`/api/sessions/${sessionId}`, { method: 'DELETE' });
  onDeleted(sessionId);
}

async function postSeen(sessionId: string): Promise<void> {
  await fetchVoid(`/api/sessions/${sessionId}/seen`, { method: 'POST' });
}

/** Runs after the server deleted a session; the chat feature passes its draft cleanup. */
export type OnSessionDeleted = (sessionId: string) => void;

export type SessionRowMutations = {
  rename: (sessionId: string, title: string) => void;
  setFavorited: (sessionId: string, favorited: boolean) => void;
  remove: (sessionId: string) => void;
  markSeen: (sessionId: string) => void;
};

/** Each edit resolves true once the server accepted it and false after it rolled back and toasted. */
export type SessionEdits = {
  rename: (sessionId: string, title: string) => Promise<boolean>;
  setFavorited: (
    sessionId: string,
    favorited: boolean,
    failureMessage?: string,
  ) => Promise<boolean>;
  remove: (sessionId: string) => Promise<boolean>;
};

const settled = (mutation: Promise<unknown>) =>
  mutation.then(
    () => true,
    () => false,
  );

// The row menu and the task header issue every session PATCH and DELETE through these mutations.
export function useSessionEdits(organizationId: string, onDeleted: OnSessionDeleted): SessionEdits {
  const queryClient = useQueryClient();
  // mutateAsync is stable, so memoized rows and effects can depend on these.
  const { mutateAsync: renameAsync } = useRenameMutation(queryClient, organizationId);
  const { mutateAsync: favoriteAsync } = useFavoriteMutation(queryClient, organizationId);
  const { mutateAsync: removeAsync } = useRemoveMutation(queryClient, organizationId, onDeleted);
  return {
    rename: useCallback(
      (sessionId: string, title: string) => settled(renameAsync({ sessionId, title })),
      [renameAsync],
    ),
    setFavorited: useCallback(
      (sessionId: string, favorited: boolean, failureMessage?: string) =>
        settled(favoriteAsync({ sessionId, favorited, failureMessage })),
      [favoriteAsync],
    ),
    remove: useCallback((sessionId: string) => settled(removeAsync({ sessionId })), [removeAsync]),
  };
}

export function useSessionMutations(
  organizationId: string,
  onDeleted: OnSessionDeleted,
): SessionRowMutations {
  const queryClient = useQueryClient();
  const edits = useSessionEdits(organizationId, onDeleted);
  const { rename, setFavorited, remove } = edits;
  // Stable identity (mutate is itself stable) so the mark-seen effect can depend on it.
  const { mutate: seenMutate } = useSeenMutation(queryClient, organizationId);

  return {
    rename: useCallback(
      (sessionId: string, title: string) => void rename(sessionId, title),
      [rename],
    ),
    setFavorited: useCallback(
      (sessionId: string, favorited: boolean) => void setFavorited(sessionId, favorited),
      [setFavorited],
    ),
    remove: useCallback((sessionId: string) => void remove(sessionId), [remove]),
    markSeen: useCallback((sessionId: string) => seenMutate({ sessionId }), [seenMutate]),
  };
}

function settle(
  queryClient: QueryClient,
  organizationId: string,
  context: RollbackContext | null | undefined,
) {
  context?.release();
  scheduleSessionListInvalidate(queryClient, organizationId);
}

function useRenameMutation(queryClient: QueryClient, organizationId: string) {
  return useMutation({
    mutationFn: (vars: { sessionId: string; title: string }) =>
      patchSession(vars.sessionId, { title: vars.title }),
    onMutate: (vars) =>
      beginField(queryClient, organizationId, vars.sessionId, 'title', vars.title),
    onError: (error, vars, context) => {
      context?.rollback();
      captureException(error, { op: 'task-rename', sessionId: vars.sessionId });
      toast.error('Couldn’t rename the task. Try again.');
    },
    onSettled: (_response, _error, _variables, context) =>
      settle(queryClient, organizationId, context),
  });
}

function useFavoriteMutation(queryClient: QueryClient, organizationId: string) {
  return useMutation({
    mutationFn: (vars: { sessionId: string; favorited: boolean; failureMessage?: string }) =>
      patchSession(vars.sessionId, { favorited: vars.favorited }),
    onMutate: (vars) =>
      beginField(
        queryClient,
        organizationId,
        vars.sessionId,
        'favoritedAt',
        vars.favorited ? new Date() : null,
      ),
    onError: (error, vars, context) => {
      context?.rollback();
      captureException(error, { op: 'task-favorite', sessionId: vars.sessionId });
      toast.error(
        vars.failureMessage ??
          (vars.favorited ? 'Couldn’t add to favorites.' : 'Couldn’t remove from favorites.'),
      );
    },
    onSettled: (_response, _error, _variables, context) =>
      settle(queryClient, organizationId, context),
  });
}

function useRemoveMutation(
  queryClient: QueryClient,
  organizationId: string,
  onDeleted: OnSessionDeleted,
) {
  return useMutation({
    mutationFn: (vars: { sessionId: string }) => deleteSession(vars.sessionId, onDeleted),
    onMutate: (vars) => beginDelete(queryClient, organizationId, vars.sessionId),
    onError: (error, vars, context) => {
      context?.rollback();
      captureException(error, { op: 'task-delete', sessionId: vars.sessionId });
      toast.error('Couldn’t delete the task. Try again.');
    },
    onSettled: (_response, _error, _variables, context) =>
      settle(queryClient, organizationId, context),
  });
}

function useSeenMutation(queryClient: QueryClient, organizationId: string) {
  const root = sessionQueryKeys.all(organizationId);
  const listKey = sessionQueryKeys.list(organizationId);
  return useMutation({
    mutationFn: (vars: { sessionId: string }) => postSeen(vars.sessionId),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: root });
      queryClient.setQueryData<InfiniteSessions>(listKey, (old) =>
        patchRow(old, vars.sessionId, { unread: false }),
      );
    },
    onError: (error, vars) => {
      // No toast: marking a task seen is a silent background write (the row
      // already suppresses the unseen dot on the active route). Log only.
      // Do not restore a whole list snapshot over newer live turn events.
      captureException(error, { op: 'task-mark-seen', sessionId: vars.sessionId });
    },
    // The live cache already knows this row is read. Refetching here races
    // persistence and can put back a dot for a turn the viewer just watched.
  });
}
