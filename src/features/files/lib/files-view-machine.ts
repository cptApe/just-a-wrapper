import type { TypeFacet } from './file-types';

type FilesViewState =
  | { kind: 'trash'; query: string }
  | { kind: 'filtered'; query: string; facet: TypeFacet | null }
  | { kind: 'folder'; path: string };

// URL parameters are the sole stored state; trash always excludes type facets.
export function filesViewState(input: {
  trash: boolean;
  type: TypeFacet | null;
  q: string;
  path: string;
}): FilesViewState {
  const query = input.q.trim();
  if (input.trash) return { kind: 'trash', query };
  if (query !== '' || input.type !== null) return { kind: 'filtered', query, facet: input.type };
  return { kind: 'folder', path: input.path };
}
