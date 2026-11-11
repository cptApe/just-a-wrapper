'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { AppError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import { captureException } from '@/lib/observability-client';
import { parseSkillDetailResponse } from '../lib/skill-response';
import type { SkillDetail, SkillListItem } from '../types';
import { skillQueryKeys } from './keys';

// Exported so the skills list's hover prefetch warms the same query the inspector reads, which
// makes opening a prefetched skill a cache hit.
export async function fetchSkillDetail(skillId: string, signal: AbortSignal): Promise<SkillDetail> {
  return parseSkillDetailResponse(
    await fetchJson(`/api/skills/${encodeURIComponent(skillId)}`, { signal }),
  );
}

// The inspector's four render states, plus `partial`: the chrome is known (from
// the list row) while the file tree is still loading.
export type SkillDetailView =
  | { kind: 'loading' }
  | { kind: 'partial'; skill: SkillDetail }
  | { kind: 'ready'; skill: SkillDetail }
  | { kind: 'missing' }
  | { kind: 'error' };

function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.context.status === 404;
}

// List metadata uses placeholderData, which is not persisted. initialData would poison the
// inspector cache with an apparently complete skill that has no files.
export function useSkillDetail(skillId: string): { view: SkillDetailView; retry: () => void } {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  // Read the row the list already holds so the inspector can paint its known
  // fields on the first frame. Not persisted (placeholderData) — see the header.
  const placeholder = useMemo<SkillDetail | undefined>(() => {
    if (organizationId === null) return undefined;
    const list = queryClient.getQueryData<SkillListItem[]>(skillQueryKeys.list(organizationId));
    const row = list?.find((item) => item.id === skillId);
    return row ? { ...row, files: [] } : undefined;
  }, [queryClient, organizationId, skillId]);

  const query = useQuery({
    // A null workspace (segment resolve failed) must never key the detail — use
    // the inert unscoped key with the query disabled so nothing executes or caches.
    queryKey:
      organizationId !== null
        ? skillQueryKeys.detail(organizationId, skillId)
        : skillQueryKeys.unscoped(skillId),
    queryFn: ({ signal }) => fetchSkillDetail(skillId, signal),
    enabled: organizationId !== null && skillId !== '',
    placeholderData: placeholder,
    // A 404 (the skill was deleted) is deterministic — retrying won't change it,
    // and it drives the `missing` state, not `error`. Other failures keep the
    // client default of 2 retries.
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 2,
  });

  useEffect(() => {
    if (query.isError && !isNotFound(query.error)) {
      captureException(query.error, { op: 'skill-inspector-load', skillId });
    }
  }, [query.isError, query.error, skillId]);

  const view = ((): SkillDetailView => {
    if (query.isError) return isNotFound(query.error) ? { kind: 'missing' } : { kind: 'error' };
    if (query.data === undefined) return { kind: 'loading' };
    // placeholderData rides only while pending; once the real read lands it's
    // gone and isPlaceholderData is false.
    if (query.isPlaceholderData) return { kind: 'partial', skill: query.data };
    return { kind: 'ready', skill: query.data };
  })();

  return {
    view,
    retry: () => {
      void query.refetch();
    },
  };
}
