import {
  IconCornerUpRight,
  IconDownload01,
  IconLink01,
  IconPencil01,
  IconTrash01,
} from '@/components/icons';
import { downloadUrl } from '../lib/download-url';
import type { FileEntry } from '../types';
import type { BrowserMenuEntry } from './browser/types';
import { triggerDownload } from './files-pane-selection';

export function createFileMenu(
  file: FileEntry,
  actions: { rename: () => void; move: () => void; share: () => void; remove: () => void },
): BrowserMenuEntry[] {
  // Opening belongs to the row itself, so its menu only lists other actions.
  return [
    { kind: 'action', id: 'rename', label: 'Rename', icon: IconPencil01, onSelect: actions.rename },
    {
      kind: 'action',
      id: 'move',
      label: 'Move to…',
      icon: IconCornerUpRight,
      onSelect: actions.move,
    },
    {
      kind: 'action',
      id: 'download',
      label: 'Download',
      icon: IconDownload01,
      onSelect: () => triggerDownload(downloadUrl(file.url), file.filename),
    },
    { kind: 'action', id: 'share', label: 'Share', icon: IconLink01, onSelect: actions.share },
    { kind: 'separator', id: 'sep' },
    {
      kind: 'action',
      id: 'delete',
      label: 'Delete',
      icon: IconTrash01,
      destructive: true,
      onSelect: actions.remove,
    },
  ];
}
