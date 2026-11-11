import { unzipSync } from 'fflate';
import { AppError } from '@/lib/errors';
import type { SkillFileEntry } from '../types';
import { validateSkillFiles } from './skill-files';

// Unzip skill folders in the browser to keep server intake JSON-only.
// Send the same validated file set as save_skill. Reject binary entries via
// fatal UTF-8 decoding.

const MAX_ZIP_BYTES = 2_000_000;

type ZipIntake = { files: SkillFileEntry[]; suggestedName: string | null };

export function skillFilesFromZip(bytes: Uint8Array): ZipIntake {
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new AppError('TOOL_INPUT_INVALID', 'That zip is too large (max 2 MB).', {
      expectedState: true,
      sizeBytes: bytes.byteLength,
    });
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'That file doesn’t look like a valid .zip.',
      { sizeBytes: bytes.byteLength },
      { cause: error },
    );
  }

  const rawPaths = Object.keys(entries).filter((path) => !path.endsWith('/') && !isZipJunk(path));
  if (rawPaths.length === 0) {
    throw new AppError('TOOL_INPUT_INVALID', 'The zip is empty.', {
      expectedState: true,
      sizeBytes: bytes.byteLength,
    });
  }

  // Zips made by "compress folder" wrap everything in one top-level directory;
  // strip it when every file shares it, so SKILL.md lands at the root.
  const prefix = commonDirectoryPrefix(rawPaths);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files: SkillFileEntry[] = [];
  for (const rawPath of rawPaths) {
    const path = rawPath.slice(prefix.length);
    let content: string;
    try {
      content = decoder.decode(entries[rawPath]);
    } catch (error) {
      throw new AppError(
        'TOOL_INPUT_INVALID',
        `"${path}" isn’t a text file. Skills hold UTF-8 text only (markdown, code, csv).`,
        { path },
        { cause: error },
      );
    }
    files.push({ path, content });
  }

  validateSkillFiles(files);

  return { files, suggestedName: suggestedNameFrom(prefix) };
}

function isZipJunk(path: string): boolean {
  const segments = path.split('/');
  return segments.some(
    (segment) => segment === '__MACOSX' || segment === '.DS_Store' || segment.startsWith('._'),
  );
}

function commonDirectoryPrefix(paths: string[]): string {
  const withDir = paths.every((path) => path.includes('/'));
  if (!withDir) return '';
  const firstPath = paths.at(0);
  if (firstPath === undefined) return '';
  const first = `${firstPath.slice(0, firstPath.indexOf('/'))}/`;
  return paths.every((path) => path.startsWith(first)) ? first : '';
}

function suggestedNameFrom(prefix: string): string | null {
  const dir = prefix.replace(/\/$/, '');
  if (dir === '') return null;
  const words = dir.replace(/[-_]+/g, ' ').trim();
  return words === '' ? null : words.charAt(0).toUpperCase() + words.slice(1);
}
