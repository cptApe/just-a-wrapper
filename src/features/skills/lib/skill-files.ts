import { AppError } from '@/lib/errors';
import type { SkillFileEntry } from '../types';

// Pure skill-folder rules shared by upload routes, ZIP intake and provider pushes.
// No server-only dependencies or fetches, so browsers and tests can import them.

export const SKILL_ENTRY_FILE = 'SKILL.md';
export const MAX_SKILL_FILES = 40;
export const MAX_SKILL_FILE_BYTES = 100_000;
const MAX_SKILL_TOTAL_BYTES = 500_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SAFE_DIRECTORY_CHARS = /[^a-z0-9-]+/g;

// Mirror skill_file path constraints so uploads cannot reach the database with unsafe paths.
function isValidSkillFilePath(path: string): boolean {
  if (path === '' || path.length > 300 || path.includes('..')) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  if (path.includes('\\') || CONTROL_CHARS.test(path)) return false;
  const segments = path.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Validate a whole upload: entry file present, sane paths, no dupes, caps. */
export function validateSkillFiles(files: SkillFileEntry[]): void {
  if (files.length === 0)
    throw new AppError('TOOL_INPUT_INVALID', 'The skill has no files.', {
      expectedState: true,
      fileCount: files.length,
    });
  if (files.length > MAX_SKILL_FILES) {
    throw new AppError('TOOL_INPUT_INVALID', `A skill can hold at most ${MAX_SKILL_FILES} files.`, {
      expectedState: true,
      fileCount: files.length,
    });
  }
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (!isValidSkillFilePath(file.path)) {
      throw new AppError('TOOL_INPUT_INVALID', `"${file.path}" isn’t a valid file path.`, {
        expectedState: true,
        path: file.path,
        fileCount: files.length,
      });
    }
    if (seen.has(file.path)) {
      throw new AppError('TOOL_INPUT_INVALID', `"${file.path}" appears more than once.`, {
        expectedState: true,
        path: file.path,
        fileCount: files.length,
      });
    }
    seen.add(file.path);
    if (file.content.length > MAX_SKILL_FILE_BYTES) {
      throw new AppError(
        'TOOL_INPUT_INVALID',
        `"${file.path}" is too large (max 100 KB per file).`,
        { expectedState: true, path: file.path, fileCount: files.length },
      );
    }
    total += file.content.length;
  }
  if (total > MAX_SKILL_TOTAL_BYTES) {
    throw new AppError('TOOL_INPUT_INVALID', 'The skill is too large (max 500 KB in total).', {
      expectedState: true,
      fileCount: files.length,
    });
  }
  if (!seen.has(SKILL_ENTRY_FILE)) {
    throw new AppError('TOOL_INPUT_INVALID', `The skill needs a ${SKILL_ENTRY_FILE} at its root.`, {
      expectedState: true,
      fileCount: files.length,
    });
  }
}

type SkillFrontmatter = {
  name: string | null;
  description: string | null;
  /** Toolkit slugs the skill declares it works with (`connections: gmail, slack`). */
  connections: string[];
};

// This format deliberately accepts three line-based scalar keys, not the full YAML language.
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  if (!frontmatter) return { name: null, description: null, connections: [] };
  const lines = frontmatter.split(/\r?\n/);
  const scalar = (key: string): string | null => {
    const line = lines.find((l) => new RegExp(`^${key}\\s*:`).test(l));
    if (!line) return null;
    const value = line
      .slice(line.indexOf(':') + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    return value || null;
  };
  const connectionsRaw = scalar('connections');
  const connections = (connectionsRaw ?? '')
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => /^[a-z0-9_]+$/.test(slug));
  return { name: scalar('name'), description: scalar('description'), connections };
}

// Anthropic requires one upload root directory matching the name in SKILL.md
// frontmatter; a mismatch returns 400.
function skillDirectoryFromName(name: string): string {
  const directory = name
    .trim()
    .toLowerCase()
    .replace(SAFE_DIRECTORY_CHARS, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return directory || 'custom-skill';
}

// The declared skill name owns the upload directory; unnamed folders use the chosen title.
export function skillDirectoryForUpload(files: SkillFileEntry[], chosenName: string): string {
  const entry = files.find((file) => file.path === SKILL_ENTRY_FILE);
  const declared = entry ? parseSkillFrontmatter(entry.content).name : null;
  return skillDirectoryFromName(declared || chosenName);
}

/** The connections a file set declares, from its SKILL.md frontmatter. */
export function skillConnectionsFromFiles(files: SkillFileEntry[]): string[] {
  const entry = files.find((file) => file.path === SKILL_ENTRY_FILE);
  return entry ? parseSkillFrontmatter(entry.content).connections : [];
}
