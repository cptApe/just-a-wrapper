'use client';

// Skill rows change at once and roll back on failure; the settling invalidate reconciles the list.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOrganizationId } from '@/components/providers/app-providers';
import { fetchJson } from '@/lib/fetch-json';
import { optimisticMutation } from '@/lib/optimistic-mutation';
import { parseCreatedSkillResponse } from '../lib/skill-response';
import type { SkillFileEntry, SkillListItem } from '../types';
import { skillQueryKeys } from './keys';

type CreateVars = { name: string; description?: string; files: SkillFileEntry[] };

function optimisticSkillRow(id: string, input: CreateVars): SkillListItem {
  const now = new Date().toISOString();
  return {
    id,
    status: 'publishing',
    anthropicSkillId: null,
    kind: 'custom',
    name: input.name,
    description: input.description ?? null,
    latestVersion: null,
    isPreset: false,
    canEdit: false,
    connections: [],
    fileCount: input.files.length,
    createdAt: now,
    updatedAt: now,
  };
}

function useSkillCache() {
  const queryClient = useQueryClient();
  const organizationId = useOrganizationId() ?? 'unscoped';
  const editList = (edit: (list: SkillListItem[] | undefined) => SkillListItem[]) =>
    queryClient.setQueryData<SkillListItem[]>(skillQueryKeys.list(organizationId), edit);
  return { queryClient, organizationId, root: skillQueryKeys.all(organizationId), editList };
}

export function useCreateSkill() {
  const { queryClient, organizationId, root, editList } = useSkillCache();
  return useMutation({
    mutationFn: async (input: CreateVars) =>
      parseCreatedSkillResponse(
        await fetchJson('/api/skills', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      ),
    ...optimisticMutation(queryClient, {
      root,
      apply: (input: CreateVars) => {
        const localId = crypto.randomUUID();
        editList((list) => [optimisticSkillRow(localId, input), ...(list ?? [])]);
        return localId;
      },
      // The upload review shows this failure beside the files it was given.
      failure: () => null,
    }),
    onSuccess: (skill, _input, context) => {
      queryClient.setQueryData<SkillListItem[]>(skillQueryKeys.list(organizationId), (list) =>
        list?.map((row) => (row.id === context.applied ? skill : row)),
      );
    },
  });
}

export function useDeleteSkill() {
  const { queryClient, organizationId, root, editList } = useSkillCache();
  return useMutation({
    mutationFn: async (input: { skillId: string }) => {
      await fetchJson(`/api/skills/${encodeURIComponent(input.skillId)}`, { method: 'DELETE' });
    },
    ...optimisticMutation(queryClient, {
      root,
      apply: (input: { skillId: string }) =>
        void editList((list) => (list ?? []).filter((row) => row.id !== input.skillId)),
      failure: (_error, input) => ({
        message: 'Couldn’t delete the skill. Try again.',
        capture: { op: 'skill-delete', skillId: input.skillId },
      }),
    }),
    onSuccess: (_response, input) => {
      toast.success('Skill deleted');
      queryClient.removeQueries({ queryKey: skillQueryKeys.detail(organizationId, input.skillId) });
    },
  });
}
