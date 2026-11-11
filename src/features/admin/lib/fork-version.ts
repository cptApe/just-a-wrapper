import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

const manifestSchema = z.object({ version: z.string().min(1) });

export const readForkVersion = cache(async (): Promise<string> => {
  const sourcePath = path.join(process.cwd(), 'package.json');
  let raw: string;
  try {
    raw = await readFile(sourcePath, 'utf8');
  } catch (cause) {
    throw new AppError('UNEXPECTED', 'Could not read the app manifest.', { sourcePath }, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new AppError(
      'UNEXPECTED',
      'The app manifest is not valid JSON.',
      { sourcePath },
      { cause },
    );
  }
  const manifest = manifestSchema.safeParse(parsed);
  if (!manifest.success) {
    throw new AppError(
      'UNEXPECTED',
      'The app manifest has no usable version.',
      { sourcePath, issues: z.treeifyError(manifest.error) },
      { cause: manifest.error },
    );
  }
  return manifest.data.version;
});
