import 'server-only';

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SkillFileEntry } from '../types';

// Git-canonical preset sources: a preset's folder lives under `content/`
// (never the DB) and is read at provision time — pushed upstream AND mirrored
// into skill_file so the tree inspector renders presets like any other skill.

/** Every file of a preset's content directory, paths relative to it. */
export async function readPresetSkillFiles(contentDir: string): Promise<SkillFileEntry[]> {
  const root = path.join(process.cwd(), contentDir);
  const names = await readdir(root, { recursive: true, withFileTypes: true });
  const files: SkillFileEntry[] = [];
  for (const entry of names) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    files.push({
      path: path.relative(root, absolute).split(path.sep).join('/'),
      content: await readFile(absolute, 'utf8'),
    });
  }
  // Deterministic order — the content hash below must not depend on readdir order.
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

// Hash every file deterministically; a changed hash triggers a shared preset version push.
export function presetContentHash(files: SkillFileEntry[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\u0000');
    hash.update(file.content);
    hash.update('\u0000');
  }
  return hash.digest('hex');
}
