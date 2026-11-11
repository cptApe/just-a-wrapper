'use client';

import { MarkdownMessage } from '@/components/ui/markdown-message';
// Direct lib import — the files barrel is server-API-only; same precedent
// as features/files/components/file-preview.tsx, which shares these helpers.
import { classifyArtifact, codeLanguage, fenceCode } from '@/features/files/lib/artifact-kind';
import type { SkillFileEntry } from '../types';

// SKILL.md leads with YAML frontmatter (name/description/connections). Rendered
// as markdown it would garble into a stray rule + run-on paragraph, so it's
// split off and shown as a fenced yaml block above the real document.
function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: null, body: content };
  return { frontmatter: match.at(1) ?? null, body: content.slice(match[0].length) };
}

// Skills are inspected here and edited in chat. Text uses the shared markdown/code renderer.
export function SkillFilePreview({ file }: { file: SkillFileEntry }) {
  if (file.content.trim() === '') {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-md bg-alpha-6 px-6 text-center text-meta text-muted-foreground">
        This file is empty.
      </div>
    );
  }

  const kind = classifyArtifact('', file.path);
  if (kind === 'markdown') {
    const { frontmatter, body } = splitFrontmatter(file.content);
    const text = frontmatter ? `${fenceCode(frontmatter, 'yaml')}\n\n${body}` : body;
    return (
      <div className="rounded-md bg-alpha-6 px-4 py-3 sm:px-5 sm:py-4">
        <MarkdownMessage text={text} />
      </div>
    );
  }

  // Code and everything else text-shaped: one highlighted block. The fence is
  // its own panel (Streamdown styles), so no extra container around it.
  const language = kind === 'html' ? 'html' : codeLanguage('', file.path);
  return <MarkdownMessage text={fenceCode(file.content, language)} />;
}
