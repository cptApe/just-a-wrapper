'use client';

import { type KeyboardEvent, useState } from 'react';
import { IconFile02 } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { PreviewNotice } from '@/features/files/components/preview-notice';
import type { OverlayComponentProps } from '@/features/overlays/types';
import { cn } from '@/lib/utils';
import { useSkillDetail } from '../api/use-skill-detail';
import { useDeleteSkill } from '../api/use-skill-mutations';
import { useEditSkillTask } from '../hooks/use-edit-skill-task';
import { connectionAppName } from '../lib/app-name';
import { skillListItemOrigin, skillOriginTitle } from '../lib/skills-view';
import type { SkillDetail } from '../types';
import { SkillFilePreview } from './skill-file-preview';

export function SkillInspectorOverlay(props: OverlayComponentProps) {
  return <SkillInspectorOverlayContent key={props.id} {...props} />;
}

function SkillInspectorOverlayContent({ id, open, onClose }: OverlayComponentProps) {
  const skillId = id ?? '';
  const { view, retry } = useSkillDetail(skillId);
  const deleteSkill = useDeleteSkill();
  // The delete confirm is pinned HERE, not derived inside the main modal:
  // clicks inside the confirm dialog count as outside-interactions on the
  // modal underneath, so the main modal must veto its close while it's up.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleting = deleteSkill.isPending;

  // The known-fields chrome renders for both the seeded `partial` view and the
  // fully-loaded `ready` view; only the file body differs (skeleton vs tree).
  const skill = view.kind === 'ready' || view.kind === 'partial' ? view.skill : null;
  const filesPending = view.kind === 'partial';
  // Fix the document frame height to prevent file-switch jumps; error notices stay content-sized.
  const showDocFrame = skill !== null || view.kind === 'loading';

  function confirmDelete() {
    if (!skill || deleting) return;
    // Hook-level callbacks survive this overlay unmounting, so a failure still rolls back and toasts.
    deleteSkill.mutate({ skillId: skill.id });
    setConfirmingDelete(false);
    onClose();
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (next || confirmingDelete) return;
          onClose();
        }}
        size={showDocFrame ? 'lg' : 'default'}
        className={showDocFrame ? 'h-[min(85dvh,800px)] max-sm:h-full' : undefined}
      >
        {skill ? (
          <SkillInspector
            // Key by skill id so per-file selection (selectedPath) + the edit-in-chat
            // busy flag reset when a different skill reuses this instance mid-exit.
            // Stable across the same skill's partial→ready transition (same id).
            key={skill.id}
            skill={skill}
            filesPending={filesPending}
            onRequestDelete={() => setConfirmingDelete(true)}
          />
        ) : (
          <>
            <ModalHeader>
              <ModalTitle className="sr-only">Skill details</ModalTitle>
            </ModalHeader>
            <ModalContent>
              {view.kind === 'loading' ? (
                <div
                  className="flex min-h-0 flex-1 flex-col gap-3 py-2"
                  aria-busy="true"
                  aria-label="Loading skill"
                >
                  <Skeleton className="h-8 rounded-md" />
                  <Skeleton className="min-h-64 flex-1 rounded-md" />
                </div>
              ) : view.kind === 'missing' ? (
                <PreviewNotice
                  borderless
                  title="This skill isn’t available"
                  message="It may have been removed."
                />
              ) : (
                <PreviewNotice
                  borderless
                  title="Couldn’t load this skill"
                  message="Check your connection and try again."
                  retry={retry}
                />
              )}
            </ModalContent>
          </>
        )}
      </Modal>

      <Modal
        open={confirmingDelete}
        onOpenChange={(next) => !next && !deleting && setConfirmingDelete(false)}
        size="sm"
      >
        <ModalHeader>
          <ModalTitle>Delete this skill?</ModalTitle>
        </ModalHeader>
        <ModalContent>
          <ModalDescription>
            {skill ? `“${skill.name}” ` : 'This skill '}
            will be removed from the workspace and detached from future agent sessions. This can’t
            be undone.
          </ModalDescription>
        </ModalContent>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setConfirmingDelete(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete skill'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}

function SkillInspector({
  skill,
  filesPending,
  onRequestDelete,
}: {
  skill: SkillDetail;
  /** The chrome is seeded from the list row while the file tree still loads. */
  filesPending: boolean;
  onRequestDelete: () => void;
}) {
  const { busy, editInChat } = useEditSkillTask(skill);
  // Selection follows the user's click; before any click (and while the tree is
  // still loading) it falls back to the first file, so files landing late from
  // the `partial` seed auto-select without an effect.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const activePath = selectedPath === null ? (skill.files.at(0)?.path ?? null) : selectedPath;
  const active = skill.files.find((file) => file.path === activePath) ?? null;
  const activeIndex = skill.files.findIndex((file) => file.path === activePath);

  // Roving arrow-key traversal over the file tabs (Home/End included). Selection
  // follows focus — the file is already loaded, so activating it is free.
  function onFilesKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = skill.files.length;
    if (count === 0) return;
    const current = activeIndex < 0 ? 0 : activeIndex;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % count;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
      next = (current - 1 + count) % count;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    if (next === null) return;
    event.preventDefault();
    const nextFile = skill.files.at(next);
    if (!nextFile) return;
    setSelectedPath(nextFile.path);
    Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')).at(next)?.focus();
  }

  return (
    <>
      <ModalHeader>
        <ModalTitle className="break-words">{skill.name}</ModalTitle>
      </ModalHeader>
      <ModalContent className="gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={skill.isPreset ? 'default' : 'muted'}>
            {skillOriginTitle(skillListItemOrigin(skill))}
          </Badge>
          {skill.connections.map((slug) => (
            <Badge key={slug} variant="outline">
              {connectionAppName(slug)}
            </Badge>
          ))}
        </div>
        {skill.description ? <ModalDescription>{skill.description}</ModalDescription> : null}

        <div className="flex flex-col gap-4 sm:flex-row">
          {filesPending ? (
            <SkillFilesLoading />
          ) : (
            <>
              <div
                role="tablist"
                aria-label="Skill files"
                aria-orientation="vertical"
                onKeyDown={onFilesKeyDown}
                // Phone: files scroll sideways as one row so the document stays
                // in view; a lone SKILL.md needs no picker at all.
                className={cn(
                  'flex shrink-0 flex-col gap-0.5 sm:sticky sm:top-0 sm:w-[200px]',
                  'max-sm:scroll-fade-x max-sm:-mx-1 max-sm:flex-row max-sm:gap-1 max-sm:overflow-x-auto max-sm:px-1 max-sm:py-0.5',
                  skill.files.length === 1 && 'max-sm:hidden',
                )}
              >
                {skill.files.map((file, index) => {
                  const selected = file.path === activePath;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      role="tab"
                      id={`skill-file-tab-${index}`}
                      aria-selected={selected}
                      aria-controls="skill-file-panel"
                      // Roving tabindex: only the active tab is in the tab order; the
                      // first is the fallback when nothing matches (stale path).
                      tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
                      onClick={() => setSelectedPath(file.path)}
                      className={cn(
                        'flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1.5 text-left text-meta max-sm:w-auto max-sm:shrink-0',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                        selected
                          ? 'bg-alpha-8 text-foreground'
                          : 'text-muted-foreground hover:bg-alpha-6 hover:text-foreground',
                      )}
                    >
                      <IconFile02 className="size-3.5 shrink-0" />
                      <span className="truncate">{file.path}</span>
                    </button>
                  );
                })}
              </div>
              <div
                role="tabpanel"
                id="skill-file-panel"
                aria-labelledby={activeIndex >= 0 ? `skill-file-tab-${activeIndex}` : undefined}
                tabIndex={0}
                className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                {active ? (
                  <SkillFilePreview key={active.path} file={active} />
                ) : (
                  <div className="flex min-h-[240px] items-center justify-center rounded-md bg-alpha-6 px-6 text-center text-meta text-muted-foreground">
                    This skill has no files yet.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </ModalContent>

      {skill.canEdit ? (
        <ModalFooter
          left={
            <Button variant="destructive" onClick={onRequestDelete} disabled={busy}>
              Delete
            </Button>
          }
        >
          {/* Edit-in-chat serializes the file contents into the primed task, so it
              waits until the tree has loaded (the seeded `partial` view has none). */}
          <Button
            variant="secondary"
            onClick={editInChat}
            disabled={busy || filesPending || skill.status === 'deleting'}
          >
            {busy ? 'Working…' : 'Edit in chat'}
          </Button>
        </ModalFooter>
      ) : null}
    </>
  );
}

// The file region while the tree loads behind the seeded chrome — same two-column
// shape as the loaded view (tab rail + panel) so the frame doesn't jump.
function SkillFilesLoading() {
  return (
    <>
      <div
        className="flex shrink-0 flex-col gap-0.5 sm:w-[200px]"
        aria-busy="true"
        aria-label="Loading skill files"
      >
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>
      <Skeleton className="min-h-64 min-w-0 flex-1 rounded-md" />
    </>
  );
}
