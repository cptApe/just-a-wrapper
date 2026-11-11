import { useQuery } from '@tanstack/react-query';
import { getUploadContext } from '@/features/files/api/upload-context';
import { scheduledQueryKeys } from './keys';
export function useScheduleUploadConfig() {
  return useQuery({
    queryKey: scheduledQueryKeys.uploadConfig(),
    queryFn: async () => {
      const { config, workspaceId } = await getUploadContext();
      return { uploadConfig: config, workspaceId };
    },
    staleTime: 5 * 60 * 1000,
  });
}
