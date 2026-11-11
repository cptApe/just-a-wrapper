import { classifyArtifact } from './artifact-kind';

type SidecarCandidate = {
  filename: string;
  mimeType: string;
};

// Callers pass only siblings from the same session. The optional predicate
// keeps surface-only constraints (such as Library folder locality) out of the
// shared identity rule.
export function findPdfSidecar<T extends SidecarCandidate>(
  filename: string,
  siblings: readonly T[],
  isEligible: (candidate: T) => boolean = () => true,
): T | null {
  const basename = filename.replace(/\.pptx$/i, '');
  return (
    siblings.find(
      (candidate) =>
        isEligible(candidate) &&
        classifyArtifact(candidate.mimeType, candidate.filename) === 'pdf' &&
        candidate.filename.replace(/\.pdf$/i, '') === basename,
    ) ?? null
  );
}
