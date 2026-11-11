import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { captureException } from '@/lib/observability-client';

// The one lifecycle for writes whose result is known in advance. Spread the result into useMutation.
// Overlapping writes share a root: only the latest may restore its snapshot, and only the last to
// finish reconciles, so a refetch can never carry the pre-write value back onto the screen.

type Snapshot = ReadonlyArray<readonly [QueryKey, unknown]>;

type MutationFailureReport = {
  /** Short toast copy. */
  message: string;
  description?: string;
  /** Observability context, normally `{ op, ...ids }`. Omit for failures the user can correct. */
  capture?: Record<string, unknown>;
};

type OptimisticMutationOptions<TVariables, TApplied> = {
  /** Cancelled, snapshotted, restored and reconciled as one unit. */
  root: QueryKey;
  /** Writes the expected result. Its return value reaches onSuccess as `context.applied`. */
  apply: (variables: TVariables) => TApplied;
  /** Null means the surface reports this failure itself. */
  failure: (error: Error, variables: TVariables) => MutationFailureReport | null;
  /** Replaces the root invalidate for caches the server component seeds. */
  settle?: () => void;
};

type OptimisticContext<TApplied> = {
  snapshot: Snapshot;
  revision: number;
  applied: TApplied;
};

const revisionsByClient = new WeakMap<QueryClient, Map<string, number>>();

function revisionsOf(client: QueryClient): Map<string, number> {
  let revisions = revisionsByClient.get(client);
  if (!revisions) {
    revisions = new Map();
    revisionsByClient.set(client, revisions);
  }
  return revisions;
}

export function optimisticMutation<TVariables, TApplied = void>(
  client: QueryClient,
  { root, apply, failure, settle }: OptimisticMutationOptions<TVariables, TApplied>,
) {
  const revisions = revisionsOf(client);
  const rootHash = hashKey(root);
  return {
    mutationKey: root,
    onMutate: async (variables: TVariables): Promise<OptimisticContext<TApplied>> => {
      // Awaited first: a cancelled fetch restores its pre-fetch state and would erase the write.
      await client.cancelQueries({ queryKey: root });
      const snapshot = client.getQueriesData({ queryKey: root });
      const revision = (revisions.get(rootHash) ?? 0) + 1;
      revisions.set(rootHash, revision);
      return { snapshot, revision, applied: apply(variables) };
    },
    onError: (
      error: Error,
      variables: TVariables,
      context: OptimisticContext<TApplied> | undefined,
    ) => {
      if (context && revisions.get(rootHash) === context.revision) {
        for (const [key, data] of context.snapshot) client.setQueryData(key, data);
      }
      const report = failure(error, variables);
      if (report === null) return;
      if (report.capture) captureException(error, report.capture);
      toast.error(report.message, { description: report.description });
    },
    onSettled: () => {
      // React Query still counts the settling mutation as pending here.
      if (client.isMutating({ mutationKey: root, exact: true }) > 1) return;
      revisions.delete(rootHash);
      if (settle) settle();
      else void client.invalidateQueries({ queryKey: root });
    },
  };
}

/** For live events: a write in flight reconciles when it settles, so its value is not fetched over. */
export function invalidateUnlessWriting(client: QueryClient, root: QueryKey): void {
  if (client.isMutating({ mutationKey: root, exact: true }) > 0) return;
  void client.invalidateQueries({ queryKey: root });
}
