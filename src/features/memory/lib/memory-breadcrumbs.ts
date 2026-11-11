import type { MemoryScope } from '../types';
import { NOTE_ROOT } from './notes';
import { SCOPE_LABEL, toVirtualPath } from './virtual-path';
export function memoryBreadcrumbs(scope: MemoryScope | null, storePath: string) {
  const list = [{ name: 'Memory', path: NOTE_ROOT }];
  if (scope === null) return list;
  list.push({
    name: SCOPE_LABEL[scope],
    path: toVirtualPath(scope, NOTE_ROOT),
  });
  if (storePath !== NOTE_ROOT) {
    let acc = '';
    for (const seg of storePath.slice(1).split('/')) {
      acc += `/${seg}`;
      list.push({ name: seg, path: toVirtualPath(scope, acc) });
    }
  }
  return list;
}
