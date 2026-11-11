'use client';

import { type FilesPaneProps, useFilesPaneModel } from '../hooks/use-files-pane-model';
import { FilesPaneView } from './files-pane-view';

// Library refinements replace shallow URL history; folder paths push.
// Initial data and load-more requests share the server-paginated item projection.
// See lib/library-search-params.ts and api/list-items.ts.

export function FilesPane(props: FilesPaneProps) {
  const model = useFilesPaneModel(props);
  return <FilesPaneView {...model} />;
}
