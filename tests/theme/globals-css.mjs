import { readFileSync } from 'node:fs';
import path from 'node:path';

// The app's real globals.css, fed to the production theme parser. The one place tests read the stylesheet.

const ROOT = path.resolve(import.meta.dirname, '../..');

export const globalsCss = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
