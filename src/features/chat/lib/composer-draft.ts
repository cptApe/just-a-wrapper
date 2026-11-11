import type {
  ComposerLibraryFile,
  ComposerLibraryFolder,
  ComposerSkill,
} from '@/features/sessions/types';
import { reduceAttachmentUpload } from './attachment-upload-machine';
import type { PendingAttachment } from './attachments';

/** Everything typed or picked into a composer and not sent yet. */
export type ComposerDraft = {
  text: string;
  attachments: PendingAttachment[];
  library: ComposerLibraryFile[];
  folders: ComposerLibraryFolder[];
  skills: ComposerSkill[];
};

export type PickKind = 'library' | 'folders' | 'skills';
type Picks = Pick<ComposerDraft, PickKind>;

export const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  text: '',
  attachments: [],
  library: [],
  folders: [],
  skills: [],
};

export type ComposerDraftEvent =
  | { type: 'text'; text: string }
  | { type: 'attach'; attachments: PendingAttachment[] }
  | { type: 'attachment'; attachment: PendingAttachment }
  | { type: 'detach'; id: string }
  // 'pick' adds to each kind given; 'choose' replaces each kind given (the skills picker confirms a full set).
  | { type: 'pick' | 'choose'; picks: Partial<Picks> }
  | { type: 'unpick'; kind: PickKind; key: string }
  | { type: 'clear' }
  // The composer left the page: files and picks go with it, the text stays.
  | { type: 'release' }
  | { type: 'restore'; draft: ComposerDraft };

/** Pure: returns the same object when the event changes nothing, so a store can report "did not move". */
export function reduceComposerDraft(
  state: ComposerDraft,
  event: ComposerDraftEvent,
): ComposerDraft {
  switch (event.type) {
    case 'text':
      return event.text === state.text ? state : { ...state, text: event.text };
    case 'attach':
      return event.attachments.length === 0
        ? state
        : { ...state, attachments: [...state.attachments, ...event.attachments] };
    case 'attachment': {
      const { attachment } = event;
      const index = state.attachments.findIndex((item) => item.id === attachment.id);
      if (index === -1 || state.attachments[index] === attachment) return state;
      return {
        ...state,
        attachments: state.attachments.map((item, at) => (at === index ? attachment : item)),
      };
    }
    case 'detach': {
      const attachments = state.attachments.filter((item) => item.id !== event.id);
      return attachments.length === state.attachments.length ? state : { ...state, attachments };
    }
    case 'pick':
      return eachPickKind(state, event.picks, (current, incoming, identity) =>
        incoming ? mergeBy(current, incoming, identity) : current,
      );
    case 'choose':
      return eachPickKind(state, event.picks, (current, incoming, identity) =>
        incoming && !sameKeys(current, incoming, identity) ? [...incoming] : current,
      );
    case 'unpick':
      return eachPickKind(state, {}, (current, _incoming, identity, kind) => {
        if (kind !== event.kind) return current;
        const kept = current.filter((pick) => identity(pick) !== event.key);
        return kept.length === current.length ? current : kept;
      });
    case 'clear':
      return isEmptyDraft(state) ? state : EMPTY_COMPOSER_DRAFT;
    case 'release':
      return isEmptyDraft({ ...state, text: '' })
        ? state
        : { ...EMPTY_COMPOSER_DRAFT, text: state.text };
    case 'restore':
      return restoreInto(state, event.draft);
  }
}

/** Something a send can carry. Skills alone are not a message. */
export function draftHasContent(draft: ComposerDraft): boolean {
  return (
    draft.text.trim().length > 0 ||
    draft.attachments.length > 0 ||
    draft.library.length > 0 ||
    draft.folders.length > 0
  );
}

function isEmptyDraft(draft: ComposerDraft): boolean {
  return (
    draft.text.length === 0 &&
    draft.attachments.length === 0 &&
    draft.library.length === 0 &&
    draft.folders.length === 0 &&
    draft.skills.length === 0
  );
}

// The restored draft goes first. Its uploads restart and its previews are rebuilt by the
// composer that shows it, because the composer that sent it has already revoked them.
function restoreInto(state: ComposerDraft, restored: ComposerDraft): ComposerDraft {
  if (isEmptyDraft(restored)) return state;
  const known = new Set(state.attachments.map((item) => item.id));
  const next: ComposerDraft = {
    ...state,
    text: [restored.text, state.text].filter(Boolean).join('\n\n'),
    attachments: [
      ...restored.attachments
        .filter((item) => !known.has(item.id))
        .map(
          (item): PendingAttachment => ({
            ...reduceAttachmentUpload(item, { type: 'interrupt' }),
            previewUrl: null,
          }),
        ),
      ...state.attachments,
    ],
  };
  return eachPickKind(next, restored, (current, incoming, identity) =>
    incoming && incoming.length > 0 ? mergeBy([...incoming], current, identity) : current,
  );
}

type PickVisitor = <T>(
  current: T[],
  incoming: readonly T[] | undefined,
  identity: (pick: T) => string,
  kind: PickKind,
) => T[];

// Every kind of pick, with what makes two picks of that kind the same pick. A new kind of pick
// is one line here and one renderer.
function eachPickKind(
  state: ComposerDraft,
  from: Partial<Picks>,
  visit: PickVisitor,
): ComposerDraft {
  const library = visit(state.library, from.library, (pick) => pick.id, 'library');
  const folders = visit(state.folders, from.folders, (pick) => pick.path, 'folders');
  const skills = visit(state.skills, from.skills, (pick) => pick.id, 'skills');
  return library === state.library && folders === state.folders && skills === state.skills
    ? state
    : { ...state, library, folders, skills };
}

function mergeBy<T>(first: T[], second: readonly T[], identity: (pick: T) => string): T[] {
  const seen = new Set(first.map(identity));
  const added = second.filter((pick) => {
    const key = identity(pick);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return added.length > 0 ? [...first, ...added] : first;
}

function sameKeys<T>(a: readonly T[], b: readonly T[], identity: (pick: T) => string): boolean {
  return (
    a.length === b.length &&
    a.every((pick, index) => {
      const other = b[index];
      return other !== undefined && identity(pick) === identity(other);
    })
  );
}
