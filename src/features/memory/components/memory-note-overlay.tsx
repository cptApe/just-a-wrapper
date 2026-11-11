'use client';

import { useId, useState } from 'react';
import { useOrganizationId } from '@/components/providers/app-providers';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { MarkdownMessage } from '@/components/ui/markdown-message';
import { Modal, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { PreviewSurface } from '@/components/ui/preview-surface';
import { Skeleton } from '@/components/ui/skeleton';
import { PreviewNotice } from '@/features/files/components/preview-notice';
import type { OverlayComponentProps } from '@/features/overlays/types';
import { cn } from '@/lib/utils';
import { useMemoryNote } from '../api/use-memory-note';
import { useMemoryNoteMutations } from '../api/use-memory-note-mutations';
import { useMemoryDraft } from '../hooks/use-memory-draft';
import { useMemoryNoteCommands } from '../hooks/use-memory-note-commands';
import { noteBasename, noteTitle } from '../lib/notes';
import { MemoryDraftFields } from './memory-draft-fields';
import { MemoryHistoryPanel } from './memory-history-panel';
import { MemoryNoteActions } from './memory-note-actions';
import { NotePathDialog } from './note-path-dialog';
// Members can read shared memory; edit controls follow access, and actions enforce it again.
export function MemoryNoteOverlay(props: OverlayComponentProps) {
  return (
    <MemoryNoteOverlayContent
      key={`${props.id ?? 'missing'}:${props.params.get('edit') === '1' ? 'edit' : 'read'}`}
      {...props}
    />
  );
}

function MemoryNoteOverlayContent(props: OverlayComponentProps) {
  const { open, onClose } = props;
  const scope = props.params.get('scope') === 'workspace' ? 'workspace' : 'you';
  const organizationId = useOrganizationId();
  const query = useMemoryNote({ organizationId, scope, id: props.id });
  const mutations = useMemoryNoteMutations(organizationId);
  const note = query.data?.note ?? null;
  const canEdit = query.data?.canEdit ?? false;
  const [historyOpen, setHistoryOpen] = useState(props.params.get('history') === '1');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(props.params.get('move') === '1');
  const draftFormId = useId();
  const {
    editor,
    actions: draftActions,
    saveDraft,
    startEdit,
    reloadAfterConflict,
  } = useMemoryDraft({
    note,
    canEdit,
    refetch: query.refetch,
    save: mutations.actions.save,
    scope,
    initialEdit: props.params.get('edit') === '1',
  });
  const { renameTo, deleteNote, onHistoryRestored } = useMemoryNoteCommands({
    note,
    scope,
    organizationId,
    mutations,
    onClose,
    closeRename: () => setRenameOpen(false),
    closeHistory: () => setHistoryOpen(false),
  });
  function cancelEdit() {
    if (editor.kind === 'saving' || editor.kind === 'reloading' || mutations.pending.remove) return;
    // Canceling a newly created empty note removes the abandoned placeholder.
    if (props.params.get('edit') === '1' && note?.content === '' && 'draft' in editor) {
      deleteNote('discard');
      return;
    }
    draftActions.cancel();
  }
  function closeNote() {
    if (editor.kind === 'saving' || editor.kind === 'reloading' || mutations.pending.remove) return;
    if ('draft' in editor && editor.draft !== (note?.content ?? '')) {
      setDiscardOpen(true);
      return;
    }
    discardAndClose();
  }
  function discardAndClose() {
    setDiscardOpen(false);
    if (props.params.get('edit') === '1' && note?.content === '' && 'draft' in editor) {
      deleteNote('discard');
      return;
    }
    onClose();
  }
  const loading = props.id !== null && query.isPending;
  const errored = props.id === null || query.isError;
  return (
    <>
      <PreviewSurface
        kind="memory-note"
        open={open}
        onOpenChange={(next) => {
          if (!next) closeNote();
        }}
        title={note ? noteTitle(note.path) : loading ? 'Loading note…' : 'Memory note'}
        actions={
          <MemoryNoteActions
            hasNote={note !== null}
            canEdit={canEdit}
            editing={'draft' in editor}
            saving={editor.kind === 'saving'}
            canSave={editor.kind === 'editing'}
            reloading={editor.kind === 'reloading'}
            historyOpen={historyOpen}
            draftFormId={draftFormId}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onToggleHistory={() => setHistoryOpen((open) => !open)}
            onRename={() => setRenameOpen(true)}
            onDelete={() => deleteNote('delete')}
          />
        }
      >
        {'draft' in editor ? (
          <div className={cn('flex h-full min-h-0 flex-col gap-5', historyOpen && 'sm:flex-row')}>
            <Form
              id={draftFormId}
              onSubmit={(event) => {
                event.preventDefault();
                saveDraft();
              }}
              className="min-w-0 flex-1 overflow-y-auto overscroll-contain py-1"
            >
              <MemoryDraftFields
                draft={editor.draft}
                conflict={editor.kind === 'conflict' || editor.kind === 'reloading'}
                saving={editor.kind === 'saving'}
                reloading={editor.kind === 'reloading'}
                label={note ? `Edit ${noteBasename(note.path)}` : 'Edit memory note'}
                onChange={draftActions.change}
                onReload={reloadAfterConflict}
              />
            </Form>
            {historyOpen && note ? (
              <MemoryHistoryPanel
                scope={scope}
                note={note}
                canEdit={false}
                onRestored={onHistoryRestored}
              />
            ) : null}
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-3 py-4" aria-busy="true" aria-label="Loading note">
            <Skeleton className="h-4 w-2/3 rounded-sm" />
            <Skeleton className="h-3 w-full rounded-sm" />
            <Skeleton className="h-3 w-5/6 rounded-sm" />
          </div>
        ) : errored ? (
          <PreviewNotice
            borderless
            title="Couldn’t open this note"
            message="It may have been deleted, or the link may be from another workspace."
            retry={() => void query.refetch()}
          />
        ) : note !== null ? (
          <div className={cn('flex h-full min-h-0 flex-col gap-5', historyOpen && 'sm:flex-row')}>
            <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {note.content !== null && note.content.trim() !== '' ? (
                <MarkdownMessage text={note.content} />
              ) : (
                <p className="text-meta text-muted-foreground">This note is empty.</p>
              )}
            </div>
            {historyOpen ? (
              <MemoryHistoryPanel
                scope={scope}
                note={note}
                canEdit={canEdit}
                onRestored={onHistoryRestored}
              />
            ) : null}
          </div>
        ) : null}
      </PreviewSurface>

      <Modal open={discardOpen} onOpenChange={setDiscardOpen} presentation="dialog" size="sm">
        <ModalHeader>
          <ModalTitle>Discard your unsaved changes?</ModalTitle>
        </ModalHeader>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
            Keep editing
          </Button>
          <Button onClick={discardAndClose}>Discard changes</Button>
        </ModalFooter>
      </Modal>
      <NotePathDialog
        open={renameOpen && note !== null}
        title="Rename or move note"
        initialPath={note?.path ?? '/'}
        busy={mutations.pending.rename}
        onOpenChange={setRenameOpen}
        onSubmit={renameTo}
      />
    </>
  );
}
