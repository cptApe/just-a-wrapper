'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { parseSkillsResponse } from '../lib/skill-response';
import type { SkillListItem } from '../types';
import { skillQueryKeys } from './keys';

async function fetchSkills(signal: AbortSignal): Promise<SkillListItem[]> {
  return parseSkillsResponse(await fetchJson('/api/skills', { signal }));
}

// Trust the server seed with the shared infinite stale time; writes invalidate it explicitly
// so mounting does not double-fetch or flash an empty list.
export function useSkills(input: {
  organizationId: string;
  initialSkills: SkillListItem[];
}): SkillListItem[] {
  const { data } = useQuery({
    queryKey: skillQueryKeys.list(input.organizationId),
    queryFn: ({ signal }) => fetchSkills(signal),
    initialData: input.initialSkills,
  });
  // initialData guarantees data is always defined.
  return data;
}
