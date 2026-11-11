import { hashKey, notifyManager, type QueryClient, type QueryKey } from '@tanstack/react-query';

/** Cache construction can happen during render. Only notify this query's readers, after that render. */
export function subscribeCachedQuery(
  client: QueryClient,
  queryKey: QueryKey,
  onChange: () => void,
) {
  const key = hashKey(queryKey);
  let active = true;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'added' && event.type !== 'updated' && event.type !== 'removed') return;
    if (hashKey(event.query.queryKey) !== key) return;
    notifyManager.schedule(() => {
      if (active) onChange();
    });
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
