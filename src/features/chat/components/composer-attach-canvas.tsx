'use client';

import { Modal } from '@/components/ui/modal';
import type {
  ComposerLibraryFile,
  ComposerLibraryFolder,
  ComposerSkill,
} from '@/features/sessions/types';
import { ComposerLibraryCanvasBody } from './composer-library-picker';
import { ComposerSkillCanvasBody } from './composer-skill-picker';

// ONE canvas for both attach flows (spec 09: one overlay family, no stacking).
// "Add from library" and "Use skills" are two BODIES of a single Modal
// instance — picking the other option from the attach menu swaps the body in
// the same panel (each open remounts via the nonce); a second canvas is never
// opened over the first. `mode` is retained (never nulled) so the
// closing slide-out keeps its content and header instead of flashing an empty
// panel; `open` gates visibility and `openNonce` (bumped by the composer on each
// open) keys the body so every open mounts a fresh picker.

export type AttachCanvasMode = 'library' | 'skill';

export function ComposerAttachCanvas({
  mode,
  open,
  openNonce,
  onClose,
  onConfirmLibrary,
  onConfirmSkills,
  skillSelectedIds,
  sessionId,
}: {
  mode: AttachCanvasMode;
  open: boolean;
  openNonce: number;
  onClose: () => void;
  onConfirmLibrary: (picks: {
    files: ComposerLibraryFile[];
    folders: ComposerLibraryFolder[];
  }) => void;
  onConfirmSkills: (skills: ComposerSkill[]) => void;
  /** Ids of the skills currently attached, so the picker opens with them selected. */
  skillSelectedIds: string[];
  /** The task the skills are for; omitted for a new chat. */
  sessionId?: string;
}) {
  const bodyKey = `${mode}-${openNonce}`;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      presentation="canvas"
      resizable
      floating
    >
      {mode === 'library' ? (
        <ComposerLibraryCanvasBody key={bodyKey} onConfirm={onConfirmLibrary} onClose={onClose} />
      ) : (
        <ComposerSkillCanvasBody
          key={bodyKey}
          sessionId={sessionId}
          initialSelectedIds={skillSelectedIds}
          onConfirm={onConfirmSkills}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
