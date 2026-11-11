import type { AdminPageMeta } from '../registry';

export function adminSourcesMarkdown(meta: AdminPageMeta): string {
  const paths = meta.sourceFiles.map((file) => `- \`${file.path}\``).join('\n');
  return `## Source files\n\n${paths}`;
}
