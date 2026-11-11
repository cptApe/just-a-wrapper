// The artifact byte proxy URL (client-safe, no imports). All previews and
// downloads go through our origin — the browser never talks to Anthropic.

export function artifactContentUrl(artifactId: string, opts: { download?: boolean } = {}): string {
  const base = `/api/artifacts/${artifactId}/content`;
  return opts.download ? `${base}?download=1` : base;
}
