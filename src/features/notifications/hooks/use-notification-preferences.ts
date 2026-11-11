'use client';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { notificationKeys } from '../api/keys';
import { getNotificationPreferences, setNotificationPreference } from '../api/preferences';
import { preferenceUpdateSchema, projectPreferences } from '../lib/preference-update';
import type { NotificationPreferences, PreferenceCategory, PreferencePatch } from '../types';

export function useNotificationPreferences(initial: NotificationPreferences) {
  const { data: session } = authClient.useSession();
  const client = useQueryClient();
  const key = notificationKeys.preferences(session?.user.id ?? null);
  const query = useQuery({
    queryKey: key,
    queryFn: getNotificationPreferences,
    initialData: initial,
  });
  const pending = useMutationState({
    filters: { mutationKey: key, status: 'pending' },
    select: (mutation) => preferenceUpdateSchema.parse(mutation.state.variables),
  });
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: 'notification-preferences' },
    mutationFn: ({ category, patch }: { category: PreferenceCategory; patch: PreferencePatch }) =>
      setNotificationPreference(category, patch),
    onSuccess: (_result, { category, patch }) => {
      client.setQueryData<NotificationPreferences>(key, (current) =>
        current ? { ...current, [category]: { ...current[category], ...patch } } : current,
      );
    },
    onError: () => {
      toast.error('Couldn’t save your notification settings. Try again.');
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return {
    prefs: projectPreferences(query.data, pending),
    update: mutation.mutate,
  };
}
