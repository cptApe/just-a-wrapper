import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cache } from 'react';
import { AppError } from '@/lib/errors';
import { parseThemeTokens } from '../lib/parse-theme-tokens';
import type { ThemeToken } from '../types';

// globals.css cannot change without a rebuild, so production reads the file
// once per server process; React cache() still dedupes within a request (dev
// keeps re-reading so edits to the file show up without a restart).
let productionTokens: Promise<ThemeToken[]> | null = null;

async function readAndParse(): Promise<ThemeToken[]> {
  // Literal segments on purpose: Next's output file tracer scopes the read to
  // this one file only when the path is static (an imported constant makes it
  // trace the whole project). Keep in step with THEME_SOURCE_PATH in constants.
  const sourcePath = path.join(process.cwd(), 'src', 'app', 'globals.css');
  let css: string;
  try {
    css = await readFile(sourcePath, 'utf8');
  } catch (cause) {
    throw new AppError(
      'UNEXPECTED',
      'Could not read the theme source file.',
      { sourcePath },
      { cause },
    );
  }
  return parseThemeTokens(css);
}

/** The editable tokens parsed from globals.css: the /app layout's edit-mode
    mount and the admin page both ask, and pay for one read. */
export const readThemeTokens = cache((): Promise<ThemeToken[]> => {
  if (process.env.NODE_ENV !== 'production') return readAndParse();
  productionTokens ??= readAndParse().catch((error: unknown) => {
    // Do not pin a failed read for the life of the process.
    productionTokens = null;
    throw error;
  });
  return productionTokens;
});
