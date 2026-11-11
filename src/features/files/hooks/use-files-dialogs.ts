import * as React from 'react';
import type { BrowserContextMenuState } from '../components/browser/types';
import type { MoveTarget } from '../components/files-pane-selection';
import type { ShareTarget } from '../types';

/** The Files pane's one-at-a-time surfaces: inline rename, the context menu, Move and Share. */
export function useFilesDialogs() {
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<BrowserContextMenuState>(null);
  const [moveTarget, setMoveTarget] = React.useState<MoveTarget | null>(null);
  const [shareTarget, setShareTarget] = React.useState<ShareTarget | null>(null);
  // Stable actions: item menus are memoised and close over them.
  const actions = React.useMemo(
    () => ({
      startRename: (key: string) => setRenamingKey(key),
      endRename: () => setRenamingKey(null),
      setContextMenu,
      closeContextMenu: () => setContextMenu(null),
      openMove: (target: MoveTarget) => setMoveTarget(target),
      closeMove: () => setMoveTarget(null),
      openShare: (target: ShareTarget) => setShareTarget(target),
      closeShare: () => setShareTarget(null),
    }),
    [],
  );
  return { renamingKey, contextMenu, moveTarget, shareTarget, ...actions };
}
