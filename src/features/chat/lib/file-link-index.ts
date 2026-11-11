import type { ArtifactSummary } from '@/features/files/types';
import { fetchJson } from '@/lib/fetch-json';
import { libraryFilesSchema, sessionArtifactsSchema } from '@/lib/file-response-schema';
import type { FileLinkIndex } from './file-link';

export function loadFileLinkIndex(sessionId: string | null): Promise<FileLinkIndex> {
  const promise = Promise.all([
    fetchJson('/api/library/items').then((body) => libraryFilesSchema.parse(body)),
    sessionId
      ? fetchJson(`/api/sessions/${sessionId}/artifacts`).then((body) =>
          sessionArtifactsSchema.parse(body),
        )
      : Promise.resolve<{ artifacts: ArtifactSummary[] }>({ artifacts: [] }),
  ]).then(
    ([library, session]): FileLinkIndex => ({
      libraryFiles: library.files,
      artifacts: session.artifacts,
      sessionId,
    }),
  );
  return promise;
}
