import type { MemoryScope } from '../types';
import { NOTE_ROOT } from './notes';

// Map the Memory virtual tree’s two root folders to personal and workspace stores.
// Share path-to-scope helpers between server seeding and client navigation.

const SCOPE_HEAD: Record<MemoryScope, string> = { you: 'about-you', workspace: 'workspace' };
// The two stores read as plain folders: the private one is "Personal", the
// shared one "Workspace".
export const SCOPE_LABEL: Record<MemoryScope, string> = { you: 'Personal', workspace: 'Workspace' };

// An unknown head means the two-folder root with no store selected.
export function readVirtualPath(vpath: string): { scope: MemoryScope | null; storePath: string } {
  if (vpath === NOTE_ROOT) return { scope: null, storePath: NOTE_ROOT };
  const [head, ...rest] = vpath.slice(1).split('/');
  const scope = (['you', 'workspace'] as const).find((s) => SCOPE_HEAD[s] === head);
  if (!scope) return { scope: null, storePath: NOTE_ROOT };
  const tail = rest.join('/');
  return { scope, storePath: tail === '' ? NOTE_ROOT : `/${tail}` };
}

export function toVirtualPath(scope: MemoryScope, storePath: string): string {
  return storePath === NOTE_ROOT ? `/${SCOPE_HEAD[scope]}` : `/${SCOPE_HEAD[scope]}${storePath}`;
}
